// lib/auth.ts
import { signInAnonymously } from 'firebase/auth';
import { auth } from './firebase';

export async function ensureAnonymousSession(): Promise<string> {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}

export async function getCurrentUserId(): Promise<string | null> {
  return auth.currentUser?.uid ?? null;
}