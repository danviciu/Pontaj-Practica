# Pontaj Practica

Aplicatie web pentru administrarea prezentei elevilor in practica:
- panou admin (clase, elevi, operatori, programe, rapoarte),
- panou elev (pontaj GPS, istoric, status zilnic),
- backend propriu (fara dependenta Base44).

## 1. Rulare locala

Prerequisites:
- Node.js 20+
- npm

Instalare:

```bash
npm install
```

Pornire completa (API + frontend):

```bash
npm run dev
```

Servicii:
- frontend: `http://127.0.0.1:4173`
- API: `http://127.0.0.1:8787`

Conturi seed:
- admin: `admin.demo@local.test` / `admin123`
- admin 2: `admin2.demo@local.test` / `admin123`
- elev: `elev.demo@local.test` / `elev123`

## 2. Variabile de mediu

Frontend (`.env.local`):

```env
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_APP_ID=pontaj-practica
VITE_FUNCTIONS_VERSION=prod
VITE_USE_DEMO=false
```

Backend (optional, shell env):
- `API_PORT` (default `8787`)
- `APP_JWT_SECRET` (default `change-me-in-production`, schimba in productie)

Persistenta locala backend:
- `server/data/db.json`

## 3. Build si quality

```bash
npm run lint
npm run build
```

## 4. Deploy frontend pe Cloudflare Pages

Setari recomandate in Cloudflare Pages:
- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `20`

Environment variables (Pages):
- `VITE_API_BASE_URL=https://api.domeniul-tau.ro`
- `VITE_APP_ID=pontaj-practica`
- `VITE_FUNCTIONS_VERSION=prod`

Routing SPA:
- fallback-ul este inclus prin `public/_redirects` (`/* /index.html 200`).

Headers:
- securitate + cache static sunt incluse prin `public/_headers`.

## 5. Backend productie

Backend-ul este Node/Express (`server/index.js`) si trebuie deploy-at separat de Pages
(de ex. VM, Render, Railway, Fly, Kubernetes). Dupa deploy:
- setezi `APP_JWT_SECRET`,
- expui HTTPS,
- pui URL-ul in `VITE_API_BASE_URL` pe Cloudflare Pages.

## 6. APK Android (Capacitor)

Proiect Android este deja generat in `android/`.

Comenzi:

```bash
npm run build
npm run cap:sync
npm run cap:android
```

Build APK debug:

```bash
npm run build:apk:debug
```

APK rezultat:
- `android/app/build/outputs/apk/debug/app-debug.apk`

Build APK release (semnat):

```bash
npm run build:apk:release
```

APK release rezultat:
- `android/app/build/outputs/apk/release/app-release.apk`

Configurare signing release:
- `android/signing.properties` (local, neversionat)
- template: `android/signing.properties.example`
- keystore local: `android/keys/pontaj-release.jks` (neversionat)
- recomanda schimbarea parolelor/keystore-ului inainte de distributie larga.

### Cerinte Android locale

Pentru build APK ai nevoie de Android SDK instalat local.
Daca apare eroarea:

`SDK location not found`

configureaza una dintre variante:
- variabila `ANDROID_HOME`,
- sau `android/local.properties` cu:

```properties
sdk.dir=C:\\Users\\<user>\\AppData\\Local\\Android\\Sdk
```

## 7. PWA

Aplicatia are acum:
- `public/manifest.json`
- `public/sw.js`
- icon-uri PWA in `public/icons/`

Aceasta permite instalare ca web app si baza pentru ambalare Android.
