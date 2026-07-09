// scripts/export.js
//
// Monthly metrics export. Reads only the PREVIOUS month's events (range query on
// `at`, so egress stays flat as history grows), rolls them up, and writes
// reports/{YYYY-MM}.json — which the GitHub Action commits to the repo.
//
// Retention is computed against reports/_seen.json (uid -> first month seen), a
// committed incremental map, so "returning users" works without re-reading all
// history. Note: _seen grows with total users — fine at this stage; a BigQuery /
// SQL pipeline is the upgrade path if it ever gets large.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const SEEN_FILE = path.join(REPORTS_DIR, '_seen.json');

(async () => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // current month, 0-based
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1) - 1;
  const prev = new Date(start);
  const label = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

  const snap = await db
    .ref('events')
    .orderByChild('at')
    .startAt(start)
    .endAt(end)
    .once('value');
  const events = Object.values(snap.val() || {});

  const bySignal = {};
  const monthUids = new Set();
  const counts = {};
  const geo = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.uid) monthUids.add(e.uid);
    const sid = e.signal_id;
    if (sid) {
      bySignal[sid] = bySignal[sid] || { types: {}, uids: new Set() };
      bySignal[sid].types[e.type] = (bySignal[sid].types[e.type] || 0) + 1;
      if (e.uid) bySignal[sid].uids.add(e.uid);
    }
    if (e.type === 'created' && e.geohash) geo[e.geohash] = (geo[e.geohash] || 0) + 1;
  }

  const incidents = Object.values(bySignal);
  const createdCount = counts['created'] || 0;
  const withJoiner = incidents.filter((i) => i.types['joined']).length;
  const claimedCount = counts['claimed'] || 0;
  const resolvedCount = counts['resolved'] || 0;
  const attempts = counts['attempt'] || 0;
  const avgParticipants =
    incidents.length > 0
      ? incidents.reduce((a, i) => a + i.uids.size, 0) / incidents.length
      : 0;

  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    seen = {};
  }
  let returning = 0;
  let newUsers = 0;
  for (const uid of monthUids) {
    if (seen[uid] && seen[uid] < label) returning++;
    else newUsers++;
    if (!seen[uid]) seen[uid] = label;
  }

  const topGeohashes = Object.entries(geo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([g, n]) => ({ geohash: g, incidents: n }));

  const report = {
    month: label,
    generated_at: new Date().toISOString(),
    users: {
      unique: monthUids.size,
      new: newUsers,
      returning,
      return_rate: monthUids.size ? +(returning / monthUids.size).toFixed(3) : 0,
    },
    incidents: {
      created: createdCount,
      with_at_least_one_joiner: withJoiner,
      join_rate: createdCount ? +(withJoiner / createdCount).toFixed(3) : 0,
      claimed: claimedCount,
      resolved: resolvedCount,
      attempts_no_change: attempts,
      resolve_rate: claimedCount ? +(resolvedCount / claimedCount).toFixed(3) : 0,
      avg_participants: +avgParticipants.toFixed(2),
    },
    engagement: {
      backings_sent: counts['backing'] || 0,
      hand_backs: counts['handed_back'] || 0,
      total_events: events.length,
    },
    geo_density: topGeohashes,
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${label}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen));

  console.log(`Wrote reports/${label}.json — ${events.length} events, ${monthUids.size} users.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});