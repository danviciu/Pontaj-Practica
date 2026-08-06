const FIREBASE_SDK_VERSION = '12.12.1';

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
    apiKey: params.get('apiKey') || '',
    authDomain: params.get('authDomain') || '',
    projectId: params.get('projectId') || '',
    storageBucket: params.get('storageBucket') || '',
    messagingSenderId: params.get('messagingSenderId') || '',
    appId: params.get('appId') || '',
    measurementId: params.get('measurementId') || '',
};

function hasFirebaseConfig(config) {
    return Boolean(config.apiKey && config.projectId && config.messagingSenderId && config.appId);
}

self.addEventListener('notificationclick', (event) => {
    event.notification?.close();

    const payloadLink = event.notification?.data?.link;
    if (!payloadLink) return;

    event.waitUntil((async () => {
        const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientsList) {
            if (client.url === payloadLink && 'focus' in client) {
                await client.focus();
                return;
            }
        }
        if (clients.openWindow) {
            await clients.openWindow(payloadLink);
        }
    })());
});

if (hasFirebaseConfig(firebaseConfig)) {
    importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`);
    importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging-compat.js`);

    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
        // For notification payloads, browser displays the notification automatically.
        if (payload?.notification) return;

        const data = payload?.data || {};
        const title = data.title || 'Reminder prezenta practica';
        const options = {
            body: data.body || '',
            icon: '/icons/icon-192.png',
            data: {
                link: data.link || '',
            },
        };

        self.registration.showNotification(title, options);
    });
}
