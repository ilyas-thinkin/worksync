/**
 * WorkSync Service Worker
 * Handles offline caching and background sync
 */

const CACHE_NAME = 'worksync-v4';
const STATIC_CACHE = 'worksync-static-v4';
const API_CACHE = 'worksync-api-v4';

// Static assets to cache
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/supervisor.html',
    '/ie.html',
    '/management.html',
    '/css/admin.css',
    '/css/supervisor.css',
    '/css/ie.css',
    '/css/management.css',
    '/css/login.css',
    '/css/offline.css',
    '/css/shop-floor.css',
    '/js/login.js',
    '/js/admin.js',
    '/js/supervisor.js',
    '/js/ie.js',
    '/js/management.js',
    '/js/offline-db.js',
    '/js/offline-sync.js',
    '/js/sw-register.js',
    '/js/sse-manager.js',
    '/js/shop-floor-ux.js',
    '/js/optimistic-ui.js'
];

// API endpoints to cache (for read operations)
const CACHEABLE_API_PATTERNS = [
    /\/api\/lines$/,
    /\/api\/products$/,
    /\/api\/operations$/,
    /\/api\/employees$/
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(STATIC_ASSETS).catch((error) => {
                    console.warn('Some assets failed to cache:', error);
                });
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            return name.startsWith('worksync-') &&
                                name !== STATIC_CACHE &&
                                name !== API_CACHE;
                        })
                        .map((name) => {
                            console.log('Service Worker: Deleting old cache', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip WebSocket and SSE connections
    if (url.pathname === '/events' || request.headers.get('accept')?.includes('text/event-stream')) {
        return;
    }

    // Handle API requests
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(handleApiRequest(request));
        return;
    }

    // Handle static assets
    event.respondWith(handleStaticRequest(request));
});

// Handle API requests - network first, cache fallback
async function handleApiRequest(request) {
    const url = new URL(request.url);

    // Check if this API is cacheable
    const isCacheable = CACHEABLE_API_PATTERNS.some(pattern => pattern.test(url.pathname));

    try {
        const networkResponse = await fetch(request);

        // Cache successful GET responses for cacheable endpoints
        if (networkResponse.ok && isCacheable) {
            const cache = await caches.open(API_CACHE);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        // Network failed - try cache
        console.log('Service Worker: Network failed for', url.pathname);

        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('Service Worker: Serving from cache', url.pathname);
            return cachedResponse;
        }

        // Return offline response for API
        return new Response(
            JSON.stringify({
                error: 'Offline',
                message: 'Network unavailable. Please try again when connected.'
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// Handle static requests - cache first, network fallback
async function handleStaticRequest(request) {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        // Update cache in background (stale-while-revalidate)
        updateCache(request);
        return cachedResponse;
    }

    // Not in cache - fetch from network
    try {
        const networkResponse = await fetch(request);

        // Cache the response
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.log('Service Worker: Network failed for static', request.url);

        // Return offline page for HTML requests
        if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/index.html');
        }

        return new Response('Offline', { status: 503 });
    }
}

// Background update cache
async function updateCache(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response);
        }
    } catch (error) {
        // Ignore - this is just a background update
    }
}

// Background sync for queued actions
self.addEventListener('sync', (event) => {
    if (event.tag === 'worksync-sync') {
        event.waitUntil(syncQueuedActions());
    }
});

async function syncQueuedActions() {
    // Notify clients to sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_REQUESTED' });
    });
}

// Handle messages from clients
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((name) => caches.delete(name))
                );
            })
        );
    }
});

// Push notification support (for future use)
self.addEventListener('push', (event) => {
    if (event.data) {
        const data = event.data.json();
        event.waitUntil(
            self.registration.showNotification(data.title || 'WorkSync', {
                body: data.body,
                icon: '/icons/icon-192.png',
                badge: '/icons/badge-72.png',
                tag: data.tag || 'worksync-notification'
            })
        );
    }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' })
            .then((clients) => {
                if (clients.length > 0) {
                    return clients[0].focus();
                }
                return self.clients.openWindow('/');
            })
    );
});

console.log('Service Worker: Loaded');
