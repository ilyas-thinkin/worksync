/**
 * WorkSync Service Worker Registration
 * Handles SW registration and update management
 */

const SWManager = {
    registration: null,
    updateAvailable: false,

    /**
     * Register the service worker
     */
    async register() {
        if (!('serviceWorker' in navigator)) {
            console.log('Service Worker not supported');
            return null;
        }

        try {
            this.registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            });

            console.log('Service Worker registered:', this.registration.scope);

            // Check for updates
            this.registration.addEventListener('updatefound', () => {
                this.handleUpdateFound();
            });

            // Handle controller change (new SW activated)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (this.updateAvailable) {
                    console.log('New Service Worker activated, reloading...');
                    window.location.reload();
                }
            });

            // Handle messages from SW
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleMessage(event.data);
            });

            // Check for waiting worker (update ready)
            if (this.registration.waiting) {
                this.showUpdateNotification();
            }

            return this.registration;
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            return null;
        }
    },

    /**
     * Handle update found
     */
    handleUpdateFound() {
        const newWorker = this.registration.installing;

        newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                this.showUpdateNotification();
            }
        });
    },

    /**
     * Show update notification
     */
    showUpdateNotification() {
        this.updateAvailable = true;

        // Create update banner if it doesn't exist
        let banner = document.getElementById('sw-update-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'sw-update-banner';
            banner.className = 'sw-update-banner';
            banner.innerHTML = `
                <span>A new version is available!</span>
                <button onclick="SWManager.applyUpdate()">Update Now</button>
                <button onclick="this.parentElement.remove()" class="dismiss">Later</button>
            `;
            document.body.appendChild(banner);

            // Add styles if not present
            if (!document.getElementById('sw-update-styles')) {
                const style = document.createElement('style');
                style.id = 'sw-update-styles';
                style.textContent = `
                    .sw-update-banner {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: linear-gradient(135deg, #667eea, #764ba2);
                        color: white;
                        padding: 12px 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 15px;
                        z-index: 10002;
                        animation: slideDown 0.3s ease;
                    }
                    .sw-update-banner button {
                        background: white;
                        color: #667eea;
                        border: none;
                        padding: 6px 14px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 500;
                    }
                    .sw-update-banner button.dismiss {
                        background: transparent;
                        color: white;
                        border: 1px solid rgba(255,255,255,0.5);
                    }
                    @keyframes slideDown {
                        from { transform: translateY(-100%); }
                        to { transform: translateY(0); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
    },

    /**
     * Apply the update
     */
    applyUpdate() {
        if (this.registration && this.registration.waiting) {
            // Tell the waiting SW to skip waiting
            this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
    },

    /**
     * Handle messages from Service Worker
     */
    handleMessage(data) {
        if (data.type === 'SYNC_REQUESTED') {
            // Trigger sync in OfflineSync if available
            if (typeof OfflineSync !== 'undefined') {
                OfflineSync.syncPendingActions();
            }
        }
    },

    /**
     * Unregister service worker
     */
    async unregister() {
        if (this.registration) {
            await this.registration.unregister();
            console.log('Service Worker unregistered');
        }
    },

    /**
     * Clear all caches
     */
    async clearCaches() {
        if (this.registration && this.registration.active) {
            this.registration.active.postMessage({ type: 'CLEAR_CACHE' });
        }

        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('All caches cleared');
    },

    /**
     * Request background sync
     */
    async requestSync(tag = 'worksync-sync') {
        if (this.registration && 'sync' in this.registration) {
            try {
                await this.registration.sync.register(tag);
                console.log('Background sync registered:', tag);
            } catch (error) {
                console.error('Background sync registration failed:', error);
            }
        }
    }
};

// Register on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => SWManager.register());
    } else {
        SWManager.register();
    }
}
