// lib/signals.ts
//
// The new Flint model: a private co-sign plus a single atomic claim.
//
// Replaces the role / GO / map-bloc model in lib/incidents.ts. It writes to a
// fresh `signals/` path on purpose, so it never mixes with legacy `incidents/`
// data — or trips the old member-gated security rules — while both models exist
// during the migration. (When you delete the legacy code at the end, this path
// just stays; the old data is short-lived and disposable.)
//
// Realtime Database layout:
//   signals/{signalId}/
//     created_at   number          server time it was flagged
//     descriptor   string | null   optional free text, e.g. "music, back of car"
//     status       'open' | 'claimed' | 'resolved'
//     claimed_by   string | null   uid of the single asker, once claimed
//     claimed_at   number | null
//     resolved_at  number | null
//     cosigns/     { [uid]: number }   private "this is bothering me too"
//     backing/     { [uid]: number }   post-incident "that took guts"

import {
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { auth, db } from './firebase';

export type SignalStatus = 'open' | 'claimed' | 'resolved';

// Raw shape stored under signals/{id}.
export type Signal = {
  created_at: number;
  descriptor: string | null;
  status: SignalStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  resolved_at?: number | null;
  cosigns?: Record<string, number>;
  backing?: Record<string, number>;
};

// Per-device view the UI consumes. The counts and the "me" flags are derived
// locally, never written back — that is what keeps the signal private to each
// viewer and invisible to the target.
export type SignalSnapshot = {
  id: string;
  status: SignalStatus;
  descriptor: string | null;
  created_at: number | null;
  claimed_by: string | null;
  claimed_by_me: boolean;
  cosign_count: number;
  has_cosigned: boolean;
  backing_count: number;
};

export type ClaimResult = {
  claimed_by_me: boolean;   // did THIS device win the single claim?
  claimed_by: string | null; // who holds it now (uid), if anyone
};

// Mirrors the pattern already in lib/incidents.ts.
function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  return uid;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Flag loud audio. The creator is auto-co-signed (they flagged it, so they're
// already bothered), which seeds the count at 1. Returns the new signalId —
// this is what BLE broadcasts later so nearby devices can subscribe.
export async function createSignal(descriptor?: string): Promise<string> {
  const uid = requireUid();
  const signalRef = push(ref(db, 'signals'));
  const id = signalRef.key;
  if (!id) throw new Error('Could not allocate a signal id.');

  const trimmed = descriptor?.trim();
  await set(signalRef, {
    created_at: serverTimestamp(),
    descriptor: trimmed ? trimmed.slice(0, 40) : null,
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    cosigns: { [uid]: serverTimestamp() },
  });

  return id;
}

// Private "this is bothering me too". Drives the count + live presence.
export async function cosign(signalId: string): Promise<void> {
  const uid = requireUid();
  await set(ref(db, `signals/${signalId}/cosigns/${uid}`), serverTimestamp());
}

// Withdraw a co-sign (changed their mind, or moved out of range).
export async function removeCosign(signalId: string): Promise<void> {
  const uid = requireUid();
  await remove(ref(db, `signals/${signalId}/cosigns/${uid}`));
}

// The atomic claim. We transact on the claimed_by LEAF (not the whole node),
// which mirrors how setMemberRole claims confronter_uid in your incidents.ts —
// and it's what lets the security rules lock the claim down. Returning a value
// (not undefined) when it's unclaimed makes Firebase re-validate against the
// server if our cached copy was stale, so a race resolves to exactly one winner.
// Only the winner then writes status + claimed_at.
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
    // Only the winner flips status + stamps the time.
    await update(ref(db, `signals/${signalId}`), {
      status: 'claimed',
      claimed_at: serverTimestamp(),
    });
  }

  return {
    claimed_by_me: wonByMe,
    claimed_by: claimedBy,
  };
}

// The asker marks it done. Single status write (the claimer only, per rules).
export async function resolveSignal(signalId: string): Promise<void> {
  await update(ref(db, `signals/${signalId}`), {
    status: 'resolved',
    resolved_at: serverTimestamp(),
  });
}

// Post-incident "that took guts", from a co-signer to the asker. Anonymous.
export async function addBacking(signalId: string): Promise<void> {
  const uid = requireUid();
  await set(ref(db, `signals/${signalId}/backing/${uid}`), serverTimestamp());
}

// Full removal — rules permit this only once the signal is resolved (cleanup).
export async function removeSignal(signalId: string): Promise<void> {
  await remove(ref(db, `signals/${signalId}`));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Live subscription to a single signal. Fires on every change with a per-device
// snapshot (or null if it's gone). Returns the unsubscribe function — call it on
// unmount / when leaving.
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

// Derive the per-device view. Counts and "me" flags are computed here, locally,
// for the current device only — never written back. We derive an EFFECTIVE
// status from claimed_by too, so the brief moment between winning the claim and
// the status write still reads as "claimed" rather than flickering back to open.
function toSnapshot(id: string, raw: Signal): SignalSnapshot {
  const uid = auth.currentUser?.uid ?? null;
  const cosigns = raw.cosigns ?? {};
  const backing = raw.backing ?? {};
  const claimedBy = raw.claimed_by ?? null;

  const status: SignalStatus =
    raw.status === 'resolved' ? 'resolved' : claimedBy != null ? 'claimed' : 'open';

  return {
    id,
    status,
    descriptor: raw.descriptor ?? null,
    created_at: typeof raw.created_at === 'number' ? raw.created_at : null,
    claimed_by: claimedBy,
    claimed_by_me: uid != null && claimedBy === uid,
    cosign_count: Object.keys(cosigns).length,
    has_cosigned: uid != null && Object.prototype.hasOwnProperty.call(cosigns, uid),
    backing_count: Object.keys(backing).length,
  };
}

// The line the app hands the single asker. First person, norm-based, and it
// never invokes the others — the count is courage on their own screen, not a
// line to say out loud.
export const ASK_SCRIPT = 'Hey — would you mind throwing on headphones?';