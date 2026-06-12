importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBuz7iwOzeEFsFDU1G5aAe69JCczaduI44",
    authDomain: "pablo-app-f6057.firebaseapp.com",
    projectId: "pablo-app-f6057",
    storageBucket: "pablo-app-f6057.firebasestorage.app",
    messagingSenderId: "764832752787",
    appId: "1:764832752787:web:21948ed789665c531b9966"
});

const messaging = firebase.messaging();

// Notif reçue en background (app fermée ou en arrière-plan)
messaging.onBackgroundMessage(payload => {
    const { title, body, icon } = payload.notification || {};
    self.registration.showNotification(title || 'Pablo 🐾', {
        body: body || 'Un rappel pour votre animal.',
        icon: icon || 'https://pablo-app-roan.vercel.app/pablo.jpg',
        badge: 'https://pablo-app-roan.vercel.app/pablo.jpg',
        data: payload.data || {}
    });
});

// Clic sur la notif → ouvre l'app
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