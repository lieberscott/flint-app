# Flint

Minimal React Native app for people bothered by loud phone audio nearby. Find others in your area on a live map, assign Confronter/Partner roles, and speak up together.

## Stack

- Expo SDK 54 + Expo Router (TypeScript)
- Firebase (anonymous auth, Realtime Database)
- `react-native-maps` + `expo-location` for map UI and foreground GPS pings

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).

3. Enable **Anonymous sign-in** in Firebase Authentication (Build → Authentication → Sign-in method).

4. Create a **Realtime Database** and set rules appropriate for your environment (start with test-mode rules while developing).

5. Add your Firebase web config to [`lib/firebase.ts`](lib/firebase.ts) (apiKey, authDomain, databaseURL, projectId, etc.).

6. Start the app:

```bash
npm start
```

Scan the QR code with **Expo Go** (SDK 54). No `.env` file is required — config lives in `lib/firebase.ts`.

For **Android production builds** with Google Maps, add a Google Maps API key to `app.json` under `android.config.googleMaps.apiKey`. Expo Go on iOS uses Apple Maps with no extra setup.

## App flow

1. **Setup** — first name, optional shirt color, location permission
2. **Map home** — full-screen map with your dot, nearby anonymous report clusters, and incident member dots
3. **Report** — tap to check in; optional transit line/direction/car for tighter matching on buses and trains
4. **Roles / Ready / Go** — bottom sheet guides confronter and partners through speaking up together

Sessions expire after 10 minutes. Users are limited to 3 incident joins per hour.

## Web

The map UI requires a native device. On web, a simplified fallback screen is shown.
