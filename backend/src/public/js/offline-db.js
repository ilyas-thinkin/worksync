/**
 * WorkSync Offline Database (IndexedDB)
 * Handles local storage for offline operation
 */

const OfflineDB = {
    DB_NAME: 'worksync_offline',
    DB_VERSION: 1,
    db: null,

    // Store names
    STORES: {
        SYNC_QUEUE: 'sync_queue',      // Pending actions to sync
        CACHE: 'data_cache',            // Cached API responses
        SETTINGS: 'settings'            // Local settings
    },

    /**
     * Initialize IndexedDB
     */
    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB initialized');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Sync queue for pending actions
                if (!db.objectStoreNames.contains(this.STORES.SYNC_QUEUE)) {
                    const syncStore = db.createObjectStore(this.STORES.SYNC_QUEUE, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    syncStore.createIndex('type', 'type', { unique: false });
                    syncStore.createIndex('status', 'status', { unique: false });
                }

                // Data cache for API responses
                if (!db.objectStoreNames.contains(this.STORES.CACHE)) {
                    const cacheStore = db.createObjectStore(this.STORES.CACHE, {
                        keyPath: 'key'
                    });
                    cacheStore.createIndex('expiry', 'expiry', { unique: false });
                }

                // Settings store
                if (!db.objectStoreNames.contains(this.STORES.SETTINGS)) {
                    db.createObjectStore(this.STORES.SETTINGS, { keyPath: 'key' });
                }
            };
        });
    },

    /**
     * Add item to sync queue (for offline actions)
     */
    async addToSyncQueue(action) {
        await this.init();

        const item = {
            ...action,
            timestamp: Date.now(),
            status: 'pending',
            retries: 0
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SYNC_QUEUE, 'readwrite');
            const store = tx.objectStore(this.STORES.SYNC_QUEUE);
            const request = store.add(item);

            request.onsuccess = () => {
                console.log('Added to sync queue:', item.type);
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get all pending items from sync queue
     */
    async getPendingSyncItems() {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SYNC_QUEUE, 'readonly');
            const store = tx.objectStore(this.STORES.SYNC_QUEUE);
            const index = store.index('status');
            const request = index.getAll('pending');

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Update sync item status
     */
    async updateSyncItem(id, updates) {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SYNC_QUEUE, 'readwrite');
            const store = tx.objectStore(this.STORES.SYNC_QUEUE);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const item = getRequest.result;
                if (item) {
                    Object.assign(item, updates);
                    const putRequest = store.put(item);
                    putRequest.onsuccess = () => resolve(item);
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('Item not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    },

    /**
     * Remove item from sync queue
     */
    async removeSyncItem(id) {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SYNC_QUEUE, 'readwrite');
            const store = tx.objectStore(this.STORES.SYNC_QUEUE);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Cache API response
     */
    async cacheData(key, data, ttlMinutes = 5) {
        await this.init();

        const item = {
            key,
            data,
            timestamp: Date.now(),
            expiry: Date.now() + (ttlMinutes * 60 * 1000)
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.CACHE, 'readwrite');
            const store = tx.objectStore(this.STORES.CACHE);
            const request = store.put(item);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get cached data
     */
    async getCachedData(key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.CACHE, 'readonly');
            const store = tx.objectStore(this.STORES.CACHE);
            const request = store.get(key);

            request.onsuccess = () => {
                const item = request.result;
                if (item && item.expiry > Date.now()) {
                    resolve(item.data);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Clear expired cache entries
     */
    async clearExpiredCache() {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.CACHE, 'readwrite');
            const store = tx.objectStore(this.STORES.CACHE);
            const index = store.index('expiry');
            const range = IDBKeyRange.upperBound(Date.now());
            const request = index.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get sync queue count
     */
    async getSyncQueueCount() {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SYNC_QUEUE, 'readonly');
            const store = tx.objectStore(this.STORES.SYNC_QUEUE);
            const index = store.index('status');
            const request = index.count('pending');

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Save setting
     */
    async saveSetting(key, value) {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SETTINGS, 'readwrite');
            const store = tx.objectStore(this.STORES.SETTINGS);
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get setting
     */
    async getSetting(key, defaultValue = null) {
        await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.STORES.SETTINGS, 'readonly');
            const store = tx.objectStore(this.STORES.SETTINGS);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result ? request.result.value : defaultValue);
            };
            request.onerror = () => reject(request.error);
        });
    }
};

// Initialize on load
if (typeof window !== 'undefined') {
    OfflineDB.init().catch(console.error);
}
