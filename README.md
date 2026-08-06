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
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

Backend (shell env):
- `API_PORT` (default `8787`)
- `APP_JWT_SECRET` (**obligatoriu**, minim 16 caractere, unic si secret) — cheia
  de semnare a tokenurilor. Nu mai exista valoare default: in productie serverul
  refuza sa porneasca daca lipseste; in dev local genereaza una efemera (sesiunile
  se reseteaza la repornire). Pentru Worker se seteaza ca secret:
  `npx wrangler secret put APP_JWT_SECRET`.
- `APP_ALLOWED_ORIGINS` (**obligatoriu in productie** pentru `server/index.js`,
  lista de origini separate prin virgula, ex.
  `https://pontaj-practica.pages.dev,https://localhost,capacitor://localhost`) —
  restrictioneaza CORS-ul la originile frontend-ului si ale aplicatiei mobile;
  in dev local, daca lipseste, CORS ramane permisiv. Worker-ul foloseste aceeasi
  variabila (optional, se adauga la lista implicita de origini) setata ca
  `npx wrangler secret put APP_ALLOWED_ORIGINS` sau in `wrangler.toml`.
- `FCM_PROJECT_ID` (ID-ul proiectului Firebase)
- `FCM_CLIENT_EMAIL` (service account email pentru FCM)
- `FCM_PRIVATE_KEY` (private key service account; pastreaza `\n` in env)
- `REMINDER_NOTIFICATION_LINK` (optional, link deschis la apasarea reminderului push)
- `RESEND_API_KEY` / `RESEND_FROM` (optional; daca lipsesc, resetarea de parola
  prin email nu trimite efectiv mailul, dar tokenul se genereaza oricum — util
  in dev local pentru testare manuala)
- `APP_PUBLIC_URL` (baza folosita in linkul de resetare parola trimis pe email;
  implicit `http://127.0.0.1:4173` local / `https://pontaj-practica.pages.dev` in Worker)

> Securitate: inrolarea publica (`/api/auth/register`) creeaza intotdeauna cont
> de elev — rolul de admin se acorda doar de un admin autenticat. Scrierile pe
> entitati (User/Operator/programe etc.) si trimiterea de notificari sunt
> admin-only; elevii isi vad doar propriile pontaje.

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

Pentru push real pe Android:
- adauga `google-services.json` in `android/app/google-services.json`,
- asigura-te ca elevul se autentifica in aplicatie o data (tokenul FCM se salveaza automat in `User.pushToken`),
- configureaza variabilele backend `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.

Pentru push real pe Web:
- adauga o aplicatie Web in Firebase (Project settings -> Your apps -> `</>`),
- copiaza config-ul Firebase in variabilele `VITE_FIREBASE_*`,
- obligatoriu pentru productie: din Firebase Console -> Cloud Messaging -> Web Push certificates, genereaza/copiaza VAPID key in `VITE_FIREBASE_VAPID_KEY`,
- dupa login elev in browser si acceptarea permisiunii de notificari, tokenul web se salveaza automat in `User.pushToken`.

Reminder automat prezenta:
- ruleaza server-side prin cron (Worker trigger), nu depinde de tab-ul admin deschis,
- configuratia pe clasa se salveaza in `Classroom.reminderSettings`.

## 7. PWA

Aplicatia are acum:
- `public/manifest.json`
- `public/sw.js`
- `public/firebase-messaging-sw.js`
- icon-uri PWA in `public/icons/`

Aceasta permite instalare ca web app si baza pentru ambalare Android.
