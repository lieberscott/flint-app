// lib/signals.ts
//
// The Flint model: private co-sign (= membership) + a single atomic claim.
//
// Membership is your presence in `cosigns`. The count is how many members there
// are. "Not me right now" sets a `stepped_back` flag but keeps you a member;
// "Leave" removes your cosign, and when the last member leaves, the whole signal
// is deleted so it disappears from everyone's screen. Backing is an emoji a
// co-signer sends the asker afterward.
//
// Realtime Database layout:
//   signals/{signalId}/
//     created_at, descriptor, status, claimed_by, claimed_at, resolved_at
//     cosigns/      { [uid]: number }   membership (drives the count)
//     stepped_back/ { [uid]: number }   members who won't be the one to ask
//     backing/      { [uid]: string }   emoji acknowledgement to the asker

import {
  ref,
  push,
  set,
  update,
  remove,
  get,
  onValue,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { auth, db } from './firebase';

export type SignalStatus = 'open' | 'claimed' | 'resolved';

// The acknowledgements a co-signer can send the asker.
export const BACKING_EMOJIS = ['👍', '❤️', '🙏'];

// A group is swept if nothing meaningful happens for this long.
export const INACTIVITY_MS = 10 * 60 * 1000;

export type Signal = {
  created_at: number;
  descriptor: string | null;
  status: SignalStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  resolved_at?: number | null;
  cosigns?: Record<string, number>;
  stepped_back?: Record<string, number>;
  backing?: Record<string, string>;
  attempts?: number;
  last_active?: number;
};

// Per-device view the UI consumes — computed locally, never written back.
export type SignalSnapshot = {
  id: string;
  status: SignalStatus;
  descriptor: string | null;
  created_at: number | null;
  claimed_by: string | null;
  claimed_by_me: boolean;
  cosign_count: number; // total members (including you, if you're one)
  has_cosigned: boolean; // are YOU a member
  stepped_back_count: number;
  i_stepped_back: boolean;
  backing_count: number;
  backing_emojis: string[]; // the emojis co-signers sent the asker
  attempts: number;
  last_active: number | null;
};

export type ClaimResult = {
  claimed_by_me: boolean;
  claimed_by: string | null;
};

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  return uid;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createSignal(descriptor?: string): Promise<string> {
  const uid = requireUid();
  const signalRef = push(ref(db, 'signals'));
  const id = signalRef.key;
  if (!id) throw new Error('Could not allocate a signal id.');

  const trimmed = descriptor?.trim();
  await set(signalRef, {
    created_at: serverTimestamp(),
    last_active: serverTimestamp(),
    descriptor: trimmed ? trimmed.slice(0, 60) : null,
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    cosigns: { [uid]: serverTimestamp() },
  });

  return id;
}

export async function cosign(signalId: string): Promise<void> {
  const uid = requireUid();
  await update(ref(db, `signals/${signalId}`), {
    [`cosigns/${uid}`]: serverTimestamp(),
    last_active: serverTimestamp(),
  });
}

export async function setSteppedBack(signalId: string, stepped: boolean): Promise<void> {
  const uid = requireUid();
  const r = ref(db, `signals/${signalId}/stepped_back/${uid}`);
  if (stepped) {
    await set(r, serverTimestamp());
  } else {
    await remove(r);
  }
}

// Leave entirely. Two sequential writes (remove membership, then conditionally
// delete the emptied signal) — a combined multi-path write trips the rules.
export async function leaveSignal(signalId: string): Promise<void> {
  const uid = requireUid();
  await remove(ref(db, `signals/${signalId}/cosigns/${uid}`));
  await remove(ref(db, `signals/${signalId}/stepped_back/${uid}`));

  const remaining = await get(ref(db, `signals/${signalId}/cosigns`));
  if (!remaining.exists()) {
    await remove(ref(db, `signals/${signalId}`));
  }
}

export async function claimSignal(signalId: string): Promise<ClaimResult> {
  const uid = requireUid();
  const claimedByRef = ref(db, `signals/${signalId}/claimed_by`);

  const result = await runTransaction(claimedByRef, (current: string | null) => {
    if (current != null) return undefined; // already claimed — abort
    return uid; // win the slot
  });

  const claimedBy = (result.snapshot.val() as string | null) ?? null;
  const wonByMe = result.committed && claimedBy === uid;

  if (wonByMe) {
    await update(ref(db, `signals/${signalId}`), {
      status: 'claimed',
      claimed_at: serverTimestamp(),
      last_active: serverTimestamp(),
    });
  }

  return { claimed_by_me: wonByMe, claimed_by: claimedBy };
}

export async function resolveSignal(signalId: string): Promise<void> {
  await update(ref(db, `signals/${signalId}`), {
    status: 'resolved',
    resolved_at: serverTimestamp(),
  });
}

// Give the ask back to the group without reporting an outcome. Claimer only:
// clears the claim and reopens the ask so anyone (including you) can take it.
export async function handBackClaim(signalId: string): Promise<void> {
  await update(ref(db, `signals/${signalId}`), {
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    last_active: serverTimestamp(),
  });
}

// The asker tried, but nothing changed. Reopen the ask and bump the attempt
// count so the group can see it's been tried (and someone else can try).
export async function reportNoChange(signalId: string, currentAttempts: number): Promise<void> {
  await update(ref(db, `signals/${signalId}`), {
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    attempts: currentAttempts + 1,
    last_active: serverTimestamp(),
  });
}

// Send the asker an emoji acknowledgement.
export async function addBacking(signalId: string, emoji: string): Promise<void> {
  const uid = requireUid();
  await set(ref(db, `signals/${signalId}/backing/${uid}`), emoji);
}

export async function removeSignal(signalId: string): Promise<void> {
  await remove(ref(db, `signals/${signalId}`));
}

// Heartbeat — refresh last_active so an actively-viewed group isn't swept.
export async function touchSignal(signalId: string): Promise<void> {
  await update(ref(db, `signals/${signalId}`), { last_active: serverTimestamp() });
}

// Best-effort staleness hint (client clock; the security rule is the real guard).
export function isStale(snap: SignalSnapshot): boolean {
  return snap.last_active != null && Date.now() - snap.last_active > INACTIVITY_MS;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function subscribeToSignal(
  signalId: string,
  callback: (signal: SignalSnapshot | null) => void,
): () => void {
  const signalRef = ref(db, `signals/${signalId}`);
  return onValue(signalRef, (snap) => {
    const raw = snap.val() as Signal | null;
    callback(raw ? toSnapshot(signalId, raw) : null);
  });
}

function toSnapshot(id: string, raw: Signal): SignalSnapshot {
  const uid = auth.currentUser?.uid ?? null;
  const cosigns = raw.cosigns ?? {};
  const steppedBack = raw.stepped_back ?? {};
  const backing = raw.backing ?? {};
  const claimedBy = raw.claimed_by ?? null;

  const status: SignalStatus =
    raw.status === 'resolved' ? 'resolved' : claimedBy != null ? 'claimed' : 'open';

  const has = (map: Record<string, unknown>) =>
    uid != null && Object.prototype.hasOwnProperty.call(map, uid);

  return {
    id,
    status,
    descriptor: raw.descriptor ?? null,
    created_at: typeof raw.created_at === 'number' ? raw.created_at : null,
    claimed_by: claimedBy,
    claimed_by_me: uid != null && claimedBy === uid,
    cosign_count: Object.keys(cosigns).length,
    has_cosigned: has(cosigns),
    stepped_back_count: Object.keys(steppedBack).length,
    i_stepped_back: has(steppedBack),
    backing_count: Object.keys(backing).length,
    backing_emojis: Object.values(backing),
    attempts: raw.attempts ?? 0,
    last_active: typeof raw.last_active === 'number' ? raw.last_active : null,
  };
}

// A calm, first-person line tailored to the kind of noise (from the descriptor).
// Never invokes the group — the count is courage on the asker's own screen.
export function scriptFor(descriptor: string | null): string {
  const d = (descriptor ?? '').toLowerCase();
  if (d.includes('music')) return 'Hey — would you mind turning the music down a bit?';
  if (d.includes('headphone') || d.includes('audio') || d.includes('video') || d.includes('speaker')) {
    return 'Hey — would you mind throwing on headphones?';
  }
  if (d.includes('call') || d.includes('talking') || d.includes('phone')) {
    return 'Hey — would you mind keeping the call down a little?';
  }
  if (d.includes('whistl')) return 'Hey — would you mind easing up on the whistling?';
  return 'Hey — would you mind keeping it down a bit?';
}