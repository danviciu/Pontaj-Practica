// Haversine formula pentru calcul distanță între două coordonate GPS
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Raza Pământului în metri
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distanța în metri
}

// Obține locația curentă
export function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocația nu este suportată de acest browser.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
            },
            (error) => {
                let message = 'Eroare la obținerea locației.';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Permisiunea pentru geolocație a fost refuzată. Te rugăm să activezi locația în setările browserului.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Informațiile de locație nu sunt disponibile.';
                        break;
                    case error.TIMEOUT:
                        message = 'Timeout la obținerea locației. Încearcă din nou.';
                        break;
                }
                reject(new Error(message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    });
}

// Formatare dată pentru dateKey (YYYY-MM-DD)
export function getDateKey(date = new Date()) {
    return date.toISOString().split('T')[0];
}