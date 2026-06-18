// Service worker PWA — cache + offline complet
const CACHE_NAME = 'pablo-app-cache-v4';
const OFFLINE_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/pablo.jpg',
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=Outfit:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS).catch(() => {}))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // API calls → network only, no cache
    if (event.request.url.includes('/api/') || event.request.url.includes('firestore')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Mettre en cache les ressources réussies
                if (response && response.status === 200 && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // Offline → fallback cache
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    // Fallback vers index.html pour les routes SPA
                    if (event.request.headers.get('accept')?.includes('text/html')) {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// Notifications push
self.addEventListener('push', event => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'Pablo 🐾', {
            body:  data.body  || 'Un rappel pour votre animal.',
            icon:  data.icon  || '/pablo.jpg',
            badge: '/pablo.jpg',
            data:  data.data  || {},
            actions: [{ action: 'open', title: 'Voir' }]
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.includes(self.location.origin) && 'focus' in client)
                    return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});