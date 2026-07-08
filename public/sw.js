// Service worker PWA — cache applicatif, API toujours reseau
const CACHE_NAME = 'pablo-app-cache-v6';
const OFFLINE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/pablo.jpg',
    '/mentions-legales.html',
    '/eleveurs.html'
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
            Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isNetworkOnly = url.pathname.startsWith('/api/')
        || url.hostname.includes('firestore.googleapis.com')
        || url.hostname.includes('identitytoolkit.googleapis.com')
        || url.hostname.includes('securetoken.googleapis.com')
        || url.hostname.includes('googleapis.com');

    if (isNetworkOnly) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then(cached => {
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match('/index.html');
                return undefined;
            }))
    );
});
