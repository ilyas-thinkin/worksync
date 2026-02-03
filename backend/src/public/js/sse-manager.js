/**
 * WorkSync SSE (Server-Sent Events) Manager
 * Handles connection with exponential backoff reconnection
 */

const SSEManager = {
    eventSource: null,
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 50,
    baseDelay: 1000,  // 1 second
    maxDelay: 30000,  // 30 seconds
    reconnectTimer: null,
    listeners: {},
    connectionListeners: [],
    url: '/events',

    /**
     * Initialize SSE connection
     * @param {string} url - SSE endpoint URL (default: /events)
     */
    init(url = '/events') {
        this.url = url;
        this.connect();

        // Reconnect on page visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                console.log('SSE: Page visible, attempting reconnection...');
                this.connect();
            }
        });

        // Reconnect when online
        window.addEventListener('online', () => {
            if (!this.isConnected) {
                console.log('SSE: Network online, attempting reconnection...');
                this.reconnectAttempts = 0; // Reset on network recovery
                this.connect();
            }
        });
    },

    /**
     * Connect to SSE endpoint
     */
    connect() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        console.log(`SSE: Connecting to ${this.url}...`);

        try {
            this.eventSource = new EventSource(this.url);

            this.eventSource.onopen = () => {
                console.log('SSE: Connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.notifyConnectionChange(true);
            };

            this.eventSource.onerror = (event) => {
                console.error('SSE: Connection error');
                this.isConnected = false;
                this.eventSource.close();
                this.notifyConnectionChange(false);
                this.scheduleReconnect();
            };

            // Handle custom event types
            this.eventSource.addEventListener('data_change', (event) => {
                this.handleEvent('data_change', event);
            });

            this.eventSource.addEventListener('heartbeat', (event) => {
                // Heartbeat received - connection is healthy
                this.lastHeartbeat = Date.now();
            });

            // Handle generic message events
            this.eventSource.onmessage = (event) => {
                this.handleEvent('message', event);
            };

        } catch (error) {
            console.error('SSE: Failed to create EventSource:', error);
            this.scheduleReconnect();
        }
    },

    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('SSE: Max reconnection attempts reached');
            this.notifyConnectionChange(false, true); // permanent failure
            return;
        }

        // Calculate delay with exponential backoff and jitter
        const exponentialDelay = Math.min(
            this.maxDelay,
            this.baseDelay * Math.pow(2, this.reconnectAttempts)
        );
        // Add jitter (±20%)
        const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5);
        const delay = Math.floor(exponentialDelay + jitter);

        this.reconnectAttempts++;

        console.log(`SSE: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    },

    /**
     * Handle received event
     */
    handleEvent(type, event) {
        try {
            const data = event.data ? JSON.parse(event.data) : null;

            // Call registered listeners
            const typeListeners = this.listeners[type] || [];
            typeListeners.forEach(callback => {
                try {
                    callback(data, event);
                } catch (err) {
                    console.error('SSE: Listener error:', err);
                }
            });

            // Call wildcard listeners
            const allListeners = this.listeners['*'] || [];
            allListeners.forEach(callback => {
                try {
                    callback(type, data, event);
                } catch (err) {
                    console.error('SSE: Listener error:', err);
                }
            });
        } catch (err) {
            console.error('SSE: Error handling event:', err);
        }
    },

    /**
     * Register event listener
     * @param {string} eventType - Event type to listen for ('*' for all)
     * @param {Function} callback - Callback function
     */
    on(eventType, callback) {
        if (!this.listeners[eventType]) {
            this.listeners[eventType] = [];
        }
        this.listeners[eventType].push(callback);
    },

    /**
     * Remove event listener
     */
    off(eventType, callback) {
        if (this.listeners[eventType]) {
            this.listeners[eventType] = this.listeners[eventType]
                .filter(cb => cb !== callback);
        }
    },

    /**
     * Register connection state listener
     * @param {Function} callback - Called with (isConnected, isPermanentFailure)
     */
    onConnectionChange(callback) {
        this.connectionListeners.push(callback);
    },

    /**
     * Notify connection state change
     */
    notifyConnectionChange(isConnected, isPermanentFailure = false) {
        this.connectionListeners.forEach(callback => {
            try {
                callback(isConnected, isPermanentFailure);
            } catch (err) {
                console.error('SSE: Connection listener error:', err);
            }
        });

        // Update connection status indicator
        this.updateStatusIndicator(isConnected, isPermanentFailure);
    },

    /**
     * Update visual connection status indicator
     */
    updateStatusIndicator(isConnected, isPermanentFailure) {
        let indicator = document.getElementById('sse-status');

        if (!indicator) {
            // Create indicator if not exists
            indicator = document.createElement('div');
            indicator.id = 'sse-status';
            indicator.className = 'sse-status-indicator';
            document.body.appendChild(indicator);
        }

        if (isConnected) {
            indicator.className = 'sse-status-indicator connected';
            indicator.innerHTML = '<span class="sse-dot"></span> Live';
            indicator.title = 'Real-time updates active';
        } else if (isPermanentFailure) {
            indicator.className = 'sse-status-indicator error';
            indicator.innerHTML = '<span class="sse-dot"></span> Disconnected';
            indicator.title = 'Connection failed - please refresh';
        } else {
            indicator.className = 'sse-status-indicator reconnecting';
            indicator.innerHTML = '<span class="sse-dot"></span> Reconnecting...';
            indicator.title = `Reconnection attempt ${this.reconnectAttempts}`;
        }
    },

    /**
     * Force reconnection
     */
    reconnect() {
        this.reconnectAttempts = 0;
        this.connect();
    },

    /**
     * Close connection
     */
    close() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.isConnected = false;
    },

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            lastHeartbeat: this.lastHeartbeat
        };
    }
};

// Add CSS for status indicator
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
        .sse-status-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 8px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 9999;
            transition: all 0.3s ease;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .sse-status-indicator.connected {
            background: #d4edda;
            color: #155724;
        }
        .sse-status-indicator.reconnecting {
            background: #fff3cd;
            color: #856404;
        }
        .sse-status-indicator.error {
            background: #f8d7da;
            color: #721c24;
        }
        .sse-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }
        .sse-status-indicator.connected .sse-dot {
            animation: sse-pulse 2s infinite;
        }
        .sse-status-indicator.reconnecting .sse-dot {
            animation: sse-blink 1s infinite;
        }
        @keyframes sse-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @keyframes sse-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }
        @media (max-width: 640px) {
            .sse-status-indicator {
                bottom: 70px;
                right: 10px;
                font-size: 11px;
                padding: 6px 10px;
            }
        }
    `;
    document.head.appendChild(style);
}
