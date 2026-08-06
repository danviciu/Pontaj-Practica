import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'ro.pontaj.practica',
    appName: 'Pontaj Practica',
    webDir: 'dist',
    bundledWebRuntime: false,
    plugins: {
        PushNotifications: {
            presentationOptions: ['badge', 'sound', 'alert'],
        },
    },
};

export default config;
