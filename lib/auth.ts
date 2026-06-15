// lib/auth.ts
import {
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  ref,
  set,
  get,
} from 'firebase/database';
import { auth, db } from './firebase';
import type { Profile } from './types';

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

export async function getProfile(userId: string): Promise<Profile | null> {
  const snap = await get(ref(db, `profiles/${userId}`));
  if (!snap.exists()) {
    return null;
  }
  const data = snap.val();
  return {
    id: userId,
    display_name: data.display_name,
    shirt_color: data.shirt_color ?? null,
  };
}

export async function saveProfile(
  userId: string,
  displayName: string,
  shirtColor: string | null,
): Promise<Profile> {
  const profile = {
    display_name: displayName.trim(),
    shirt_color: shirtColor,
  };
  await set(ref(db, `profiles/${userId}`), profile);
  return { id: userId, ...profile };
}