const CACHE_NAME = 'pablo-app-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/pablo.jpg',
  '/manifest.json'
];

// Installation du Service Worker et mise en cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Fichiers en cache pour le mode hors-ligne');
        return cache.addAll(urlsToCache);
      })
  );
});

// Interception des requêtes pour un chargement instantané
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Retourne le fichier en cache s'il existe, sinon va le chercher sur internet
        return response || fetch(event.request);
      })
  );
});