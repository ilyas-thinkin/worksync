/**
 * WorkSync Offline Sync Manager
 * Handles offline action queuing and background sync
 */

const OfflineSync = {
    isOnline: navigator.onLine,
    isSyncing: false,
    syncRetryDelay: 5000,
    maxRetries: 5,
    listeners: [],

    /**
     * Initialize offline sync manager
     */
    init() {
        // Monitor online/offline status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Initial status
        this.isOnline = navigator.onLine;
        this.updateStatusIndicator();

        // Try to sync any pending items on load
        if (this.isOnline) {
            setTimeout(() => this.syncPendingActions(), 2000);
        }

        // Periodic sync check
        setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.syncPendingActions();
            }
        }, 30000);

        console.log('OfflineSync initialized, online:', this.isOnline);
    },

    /**
     * Handle coming online
     */
    async handleOnline() {
        console.log('Network: Back online');
        this.isOnline = true;
        this.updateStatusIndicator();
        this.notifyListeners('online');

        // Start syncing pending actions
        await this.syncPendingActions();
    },

    /**
     * Handle going offline
     */
    handleOffline() {
        console.log('Network: Gone offline');
        this.isOnline = false;
        this.updateStatusIndicator();
        this.notifyListeners('offline');
    },

    /**
     * Queue an action for sync
     */
    async queueAction(type, endpoint, method, data) {
        const action = {
            type,
            endpoint,
            method,
            data,
            queuedAt: new Date().toISOString()
        };

        await OfflineDB.addToSyncQueue(action);
        this.updateSyncBadge();

        // Try immediate sync if online
        if (this.isOnline) {
            this.syncPendingActions();
        }

        return action;
    },

    /**
     * Sync all pending actions
     */
    async syncPendingActions() {
        if (this.isSyncing || !this.isOnline) return;

        this.isSyncing = true;
        this.updateStatusIndicator();

        try {
            const pendingItems = await OfflineDB.getPendingSyncItems();

            if (pendingItems.length === 0) {
                this.isSyncing = false;
                this.updateStatusIndicator();
                return;
            }

            console.log(`Syncing ${pendingItems.length} pending actions...`);

            // Sort by timestamp (oldest first)
            pendingItems.sort((a, b) => a.timestamp - b.timestamp);

            for (const item of pendingItems) {
                if (!this.isOnline) break;

                try {
                    await this.syncItem(item);
                    await OfflineDB.removeSyncItem(item.id);
                    console.log(`Synced: ${item.type}`);
                } catch (error) {
                    console.error(`Sync failed for ${item.type}:`, error);

                    // Update retry count
                    item.retries = (item.retries || 0) + 1;

                    if (item.retries >= this.maxRetries) {
                        // Mark as failed after max retries
                        await OfflineDB.updateSyncItem(item.id, {
                            status: 'failed',
                            error: error.message
                        });
                        this.notifyListeners('syncFailed', item);
                    } else {
                        await OfflineDB.updateSyncItem(item.id, {
                            retries: item.retries,
                            lastError: error.message
                        });
                    }
                }
            }

            this.updateSyncBadge();
            this.notifyListeners('syncComplete');
        } catch (error) {
            console.error('Sync process error:', error);
        } finally {
            this.isSyncing = false;
            this.updateStatusIndicator();
        }
    },

    /**
     * Sync a single item
     */
    async syncItem(item) {
        const response = await fetch(item.endpoint, {
            method: item.method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: item.data ? JSON.stringify(item.data) : undefined
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    },

    /**
     * Make an API request with offline fallback
     */
    async fetchWithOffline(endpoint, options = {}) {
        const { method = 'GET', body, cacheKey, cacheTTL = 5, offlineAction } = options;

        // For GET requests, try cache first if offline
        if (method === 'GET' && cacheKey) {
            if (!this.isOnline) {
                const cached = await OfflineDB.getCachedData(cacheKey);
                if (cached) {
                    console.log('Serving from cache:', cacheKey);
                    return { data: cached, fromCache: true };
                }
                throw new Error('Offline and no cached data available');
            }
        }

        // For write operations when offline, queue them
        if (!this.isOnline && method !== 'GET' && offlineAction) {
            await this.queueAction(offlineAction.type, endpoint, method, body);
            return { queued: true, message: 'Action queued for sync' };
        }

        // Online - make the request
        try {
            const response = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: body ? JSON.stringify(body) : undefined
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            // Cache GET responses
            if (method === 'GET' && cacheKey) {
                await OfflineDB.cacheData(cacheKey, data, cacheTTL);
            }

            return { data, fromCache: false };
        } catch (error) {
            // On network error for write operations, queue them
            if (method !== 'GET' && offlineAction && error.message.includes('fetch')) {
                this.isOnline = false;
                this.updateStatusIndicator();
                await this.queueAction(offlineAction.type, endpoint, method, body);
                return { queued: true, message: 'Action queued for sync' };
            }

            // For GET, try cache as fallback
            if (method === 'GET' && cacheKey) {
                const cached = await OfflineDB.getCachedData(cacheKey);
                if (cached) {
                    console.log('Serving stale cache:', cacheKey);
                    return { data: cached, fromCache: true, stale: true };
                }
            }

            throw error;
        }
    },

    /**
     * Update the online/offline status indicator
     */
    updateStatusIndicator() {
        let indicator = document.getElementById('offline-indicator');

        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.className = 'offline-indicator';
            document.body.appendChild(indicator);
        }

        if (!this.isOnline) {
            indicator.innerHTML = `
                <span class="offline-icon">⚠</span>
                <span class="offline-text">Offline</span>
            `;
            indicator.classList.add('show', 'offline');
            indicator.classList.remove('syncing');
        } else if (this.isSyncing) {
            indicator.innerHTML = `
                <span class="sync-icon">↻</span>
                <span class="offline-text">Syncing...</span>
            `;
            indicator.classList.add('show', 'syncing');
            indicator.classList.remove('offline');
        } else {
            indicator.classList.remove('show', 'offline', 'syncing');
        }
    },

    /**
     * Update sync badge count
     */
    async updateSyncBadge() {
        try {
            const count = await OfflineDB.getSyncQueueCount();
            const badge = document.getElementById('sync-badge');

            if (badge) {
                if (count > 0) {
                    badge.textContent = count;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error updating sync badge:', error);
        }
    },

    /**
     * Add event listener
     */
    on(event, callback) {
        this.listeners.push({ event, callback });
    },

    /**
     * Remove event listener
     */
    off(event, callback) {
        this.listeners = this.listeners.filter(
            l => l.event !== event || l.callback !== callback
        );
    },

    /**
     * Notify listeners
     */
    notifyListeners(event, data) {
        this.listeners
            .filter(l => l.event === event)
            .forEach(l => l.callback(data));
    },

    /**
     * Get current status
     */
    getStatus() {
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing
        };
    }
};

// Initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => OfflineSync.init());
    } else {
        OfflineSync.init();
    }
}
