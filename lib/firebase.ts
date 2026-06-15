// lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCVhBH5EYWauC6_8sIAxdUkQvjVRAlULy4",
  authDomain: "flint-app-596cd.firebaseapp.com",
  databaseURL: "https://flint-app-596cd-default-rtdb.firebaseio.com",
  projectId: "flint-app-596cd",
  storageBucket: "flint-app-596cd.firebasestorage.app",
  messagingSenderId: "603163397524",
  appId: "1:603163397524:web:226188fb2ed19b82dd5381",
  measurementId: "G-NTEN1KKT25"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getDatabase(app);
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);