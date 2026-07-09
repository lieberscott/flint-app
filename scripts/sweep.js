// scripts/sweep.js
//
// Guaranteed backstop for stale-group cleanup. Runs on a schedule (GitHub
// Action) via the Firebase Admin SDK, which bypasses security rules. Deletes any
// signal whose last_active is older than the inactivity window (or that's empty /
// has no stamp), plus orphaned rendezvous tokens. This catches zombies in dead
// zones the client-side sweep never reaches.

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

const INACTIVITY_MS = 10 * 60 * 1000;

(async () => {
  const now = Date.now();
  const snap = await db.ref('signals').once('value');
  const signals = snap.val() || {};

  const updates = {};
  const deletedIds = new Set();
  let swept = 0;

  for (const [id, sig] of Object.entries(signals)) {
    const lastActive = sig && sig.last_active;
    const stale = typeof lastActive === 'number' && now - lastActive > INACTIVITY_MS;
    const empty = !sig || !sig.cosigns;
    const noStamp = typeof lastActive !== 'number';
    if (stale || empty || noStamp) {
      updates['signals/' + id] = null;
      deletedIds.add(id);
      swept++;
    }
  }

  // Clear rendezvous tokens that point at signals which no longer exist.
  const rzSnap = await db.ref('rendezvous').once('value');
  const rz = rzSnap.val() || {};
  let rzCleared = 0;
  for (const [token, sid] of Object.entries(rz)) {
    if (!signals[sid] || deletedIds.has(sid)) {
      updates['rendezvous/' + token] = null;
      rzCleared++;
    }
  }

  if (Object.keys(updates).length > 0) await db.ref().update(updates);
  console.log(`Swept ${swept} signals, cleared ${rzCleared} rendezvous tokens.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});