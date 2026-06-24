// lib/incidents.ts
import {
  ref,
  get,
  set,
  update,
  push,
  onValue,
  query,
  orderByChild,
  equalTo,
  runTransaction,
} from 'firebase/database';
import { auth, db } from './firebase';
import { encodeGeohash } from './location';
import type { NearbyCluster } from './map';
import type {
  Incident,
  IncidentMember,
  MatchIncidentResponse,
  MemberRole,
} from './types';

export type { NearbyCluster } from './map';

// Geohash bucket size for nearby queries (~0.6km x 1.2km cells).
const GEOHASH_PRECISION = 6;

// One precision-6 cell spans roughly this many degrees.
const LAT_CELL_DEGREES = 0.0055;
const LNG_CELL_DEGREES = 0.011;

// The geohash of the user's cell plus its 8 neighbors (a 3x3 grid).
// We query all 9 so we never miss someone sitting just across a cell line.
function neighborGeohashes(lat: number, lng: number): string[] {
  const cells = new Set<string>();
  for (const dLat of [-LAT_CELL_DEGREES, 0, LAT_CELL_DEGREES]) {
    for (const dLng of [-LNG_CELL_DEGREES, 0, LNG_CELL_DEGREES]) {
      cells.add(encodeGeohash(lat + dLat, lng + dLng, GEOHASH_PRECISION));
    }
  }
  return Array.from(cells);
}

// Read only the rows at `path` whose geohash falls in the 9 nearby cells,
// instead of downloading the whole table. Works for both the full
// 'incidents' table and the lightweight 'incident_summaries' table.
async function fetchByGeohash(
  path: 'incidents' | 'incident_summaries',
  lat: number,
  lng: number,
): Promise<Array<[string, Record<string, unknown>]>> {
  const buckets = neighborGeohashes(lat, lng);
  const snaps = await Promise.all(
    buckets.map((bucket) =>
      get(query(ref(db, path), orderByChild('geohash'), equalTo(bucket))),
    ),
  );

  const result: Array<[string, Record<string, unknown>]> = [];
  const seen = new Set<string>();
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const rows = snap.val() as Record<string, Record<string, unknown>>;
    for (const [id, row] of Object.entries(rows)) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push([id, row]);
    }
  }
  return result;
}

// True if a summary should appear on the map (open/ready, not expired, has a position).
function isSummaryActive(summary: Record<string, unknown>, now: number): boolean {
  return (
    ['open', 'ready'].includes(String(summary.status)) &&
    Number(summary.expires_at) > now &&
    summary.lat != null &&
    summary.lng != null
  );
}

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isJoinableIncident(incident: Record<string, unknown>, now: number): boolean {
  return (
    ['open', 'ready'].includes(String(incident.status)) &&
    Number(incident.expires_at) > now &&
    incident.last_lat != null &&
    incident.last_lng != null
  );
}

async function checkRateLimit(userId: string): Promise<void> {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const snap = await get(ref(db, `rate_limits/${userId}`));
  if (!snap.exists()) return;

  const entries = snap.val() as Record<string, number>;
  const recent = Object.values(entries).filter((t) => t > oneHourAgo);
  if (recent.length >= 3) {
    throw new Error('Rate limit exceeded — max 3 reports per hour.');
  }

  // Tidy up timestamps older than an hour so this list can't grow forever.
  const removeStale: Record<string, null> = {};
  for (const [key, t] of Object.entries(entries)) {
    if (t <= oneHourAgo) removeStale[key] = null;
  }
  if (Object.keys(removeStale).length > 0) {
    await update(ref(db, `rate_limits/${userId}`), removeStale);
  }
}

async function recordRateLimit(userId: string): Promise<void> {
  await push(ref(db, `rate_limits/${userId}`), Date.now());
}

export async function reportNuisance(
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  description?: string | null,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  await checkRateLimit(userId);

  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const geohash = encodeGeohash(lat, lng, GEOHASH_PRECISION);

  // Every report creates its own incident — no auto-merge.
  const newRef = push(ref(db, 'incidents'));
  const incidentId = newRef.key!;
  await set(newRef, {
    description: description?.trim().slice(0, 40) || null,
    geohash,
    status: 'open',
    expires_at: expiresAt,
    last_lat: lat,
    last_lng: lng,
    last_heading: heading,
    last_speed: speed,
    created_at: now,
  });

  await recordRateLimit(userId);
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);
  await _checkReady(incidentId);
  await _writeSummary(incidentId);

  return _buildResponse(incidentId, userId);
}

export async function joinIncident(
  incidentId: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  const incidentSnap = await get(ref(db, `incidents/${incidentId}`));
  if (!incidentSnap.exists()) {
    throw new Error('Report not found');
  }

  const incident = incidentSnap.val() as Record<string, unknown>;
  const now = Date.now();
  if (!isJoinableIncident(incident, now)) {
    throw new Error('This report is no longer active');
  }

  const expiresAt = now + 10 * 60 * 1000;
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);
  await _checkReady(incidentId);
  await _writeSummary(incidentId);

  return _buildResponse(incidentId, userId);
}

export async function pingIncident(
  incidentId: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  const expiresAt = Date.now() + 10 * 60 * 1000;
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);
  await _refreshSummaryIfStale(incidentId);

  return _buildResponse(incidentId, userId);
}

async function _upsertMember(
  incidentId: string,
  userId: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
): Promise<void> {
  const memberRef = ref(db, `incident_members/${incidentId}/${userId}`);
  const snap = await get(memberRef);
  if (snap.exists()) {
    await update(memberRef, { last_lat: lat, last_lng: lng, heading, speed });
  } else {
    await set(memberRef, {
      user_id: userId,
      role: 'bothered',
      last_lat: lat,
      last_lng: lng,
      heading,
      speed,
      joined_at: Date.now(),
    });
  }
}

async function _refreshExpiry(
  incidentId: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  expiresAt: number,
): Promise<void> {
  await update(ref(db, `incidents/${incidentId}`), {
    last_lat: lat,
    last_lng: lng,
    last_heading: heading,
    last_speed: speed,
    geohash: encodeGeohash(lat, lng, GEOHASH_PRECISION),
    expires_at: expiresAt,
  });
}

async function _checkReady(incidentId: string): Promise<void> {
  const snap = await get(ref(db, `incident_members/${incidentId}`));
  if (!snap.exists()) return;

  const members: Record<string, { role: MemberRole }> = snap.val();
  const roles = Object.values(members).map((m) => m.role);
  const hasConfronter = roles.includes('confronter');
  const partnerCount = roles.filter((r) => r === 'partner').length;

  if (hasConfronter && partnerCount >= 1) {
    await update(ref(db, `incidents/${incidentId}`), { status: 'ready' });
  }
}

async function _buildResponse(
  incidentId: string,
  userId: string,
): Promise<MatchIncidentResponse> {
  const [incidentSnap, membersSnap] = await Promise.all([
    get(ref(db, `incidents/${incidentId}`)),
    get(ref(db, `incident_members/${incidentId}`)),
  ]);

  const incident = incidentSnap.val();
  const members = membersSnap.exists() ? Object.values(membersSnap.val()) : [];
  const memberCount = members.length;
  const othersCount = Math.max(memberCount - 1, 0);

  return {
    incident_id: incidentId,
    member_count: memberCount,
    others_count: othersCount,
    status: incident?.status ?? 'open',
  };
}

const SUMMARY_REFRESH_MS = 12000; // a dot you haven't joined refreshes at most this often

// The lightweight "dot" the map listens to: position, head count, status.
// Written only at meaningful moments (report / join / role / go / close),
// never on every GPS ping — that is what stops the map waking up constantly.
async function _writeSummary(incidentId: string): Promise<void> {
  const [incidentSnap, membersSnap] = await Promise.all([
    get(ref(db, `incidents/${incidentId}`)),
    get(ref(db, `incident_members/${incidentId}`)),
  ]);
  if (!incidentSnap.exists()) return;

  const incident = incidentSnap.val() as Record<string, unknown>;
  const memberCount = membersSnap.exists() ? Object.keys(membersSnap.val()).length : 0;

  await set(ref(db, `incident_summaries/${incidentId}`), {
    lat: incident.last_lat ?? null,
    lng: incident.last_lng ?? null,
    geohash: incident.geohash ?? null,
    description: incident.description ?? null,
    status: incident.status ?? 'open',
    member_count: memberCount,
    expires_at: incident.expires_at ?? 0,
    updated_at: Date.now(),
  });
}

// Called from the 5-second ping loop. Refreshes the dot only if it has not
// been refreshed recently, so a steady stream of pings does not keep
// rewriting the summary (and waking everyone's map).
async function _refreshSummaryIfStale(incidentId: string): Promise<void> {
  const snap = await get(ref(db, `incident_summaries/${incidentId}/updated_at`));
  const lastUpdated = snap.exists() ? Number(snap.val()) : 0;
  if (Date.now() - lastUpdated > SUMMARY_REFRESH_MS) {
    await _writeSummary(incidentId);
  }
}

// Delete an incident and everything attached to it, in one write.
async function _deleteIncidentData(incidentId: string): Promise<void> {
  await update(ref(db), {
    [`incidents/${incidentId}`]: null,
    [`incident_members/${incidentId}`]: null,
    [`incident_summaries/${incidentId}`]: null,
  });
}

// Record one resolved nuisance for the permanent, anonymized metric.
// Bumps a lifetime counter and logs a de-identified event (no names,
// no user IDs, no precise location — just a coarse ~20km area cell).
async function _recordResolved(
  incident: Record<string, unknown>,
  memberCount: number,
): Promise<void> {
  await runTransaction(ref(db, 'metrics/incidents_resolved'), (current) => (current ?? 0) + 1);

  const createdAt = Number(incident.created_at ?? Date.now());
  const coarseArea =
    typeof incident.geohash === 'string' ? incident.geohash.slice(0, 4) : null;

  await push(ref(db, 'metrics/resolved_events'), {
    resolved_at: Date.now(),
    duration_seconds: Math.max(0, Math.round((Date.now() - createdAt) / 1000)),
    group_size: memberCount,
    area: coarseArea,
  });
}

export async function listNearbyIncidents(
  lat: number,
  lng: number,
  radiusMeters = 200,
): Promise<NearbyCluster[]> {
  const now = Date.now();
  const summaries = await fetchByGeohash('incident_summaries', lat, lng);
  const clusters: NearbyCluster[] = [];

  for (const [incidentId, summary] of summaries) {
    // Opportunistic cleanup: if we happen to read a timed-out incident,
    // delete its leftover data so dead records don't pile up.
    if (Number(summary.expires_at) <= now) {
      void _deleteIncidentData(incidentId);
      continue;
    }
    if (!isSummaryActive(summary, now)) continue;

    const summaryLat = Number(summary.lat);
    const summaryLng = Number(summary.lng);
    const distance = haversineMeters(lat, lng, summaryLat, summaryLng);
    if (distance > radiusMeters) continue;

    const memberCount = Number(summary.member_count ?? 0);
    if (memberCount === 0) continue;

    clusters.push({
      incidentId,
      lat: summaryLat,
      lng: summaryLng,
      memberCount,
      description: typeof summary.description === 'string' ? summary.description : null,
    });
  }

  return clusters.sort((a, b) => b.memberCount - a.memberCount);
}

export function subscribeToNearbyIncidents(
  lat: number,
  lng: number,
  radiusMeters: number,
  onChange: (clusters: NearbyCluster[]) => void,
): () => void {
  const buckets = neighborGeohashes(lat, lng);
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Collapse a burst of callbacks (e.g. all 9 bucket listeners firing at
  // once on attach) into a single read.
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!active) return;
      const clusters = await listNearbyIncidents(lat, lng, radiusMeters);
      onChange(clusters);
    }, 250);
  };

  // Listen ONLY to the lightweight summaries in the 9 nearby cells.
  // We no longer listen to `incidents` or `incident_members`, so other
  // people's 5-second GPS pings never wake this map.
  const unsubscribers = buckets.map((bucket) =>
    onValue(
      query(ref(db, 'incident_summaries'), orderByChild('geohash'), equalTo(bucket)),
      refresh,
    ),
  );

  return () => {
    active = false;
    if (timer) clearTimeout(timer);
    unsubscribers.forEach((unsub) => unsub());
  };
}

export async function setMemberRole(
  incidentId: string,
  role: MemberRole,
): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  if (role === 'confronter') {
    // Atomically claim the single confronter slot. The updater runs against
    // the latest value, so if two people tap "I'll speak first" at the same
    // instant, only the first write wins; the second sees the slot already
    // taken, aborts, and we tell that user it's unavailable.
    const claim = await runTransaction(
      ref(db, `incidents/${incidentId}/confronter_uid`),
      (current) => (current == null || current === userId ? userId : undefined),
    );
    if (!claim.committed) {
      throw new Error('Someone is already the confronter');
    }
  } else {
    // Choosing a non-confronter role: if we were the one holding the
    // confronter slot, release it so someone else can claim it.
    await runTransaction(
      ref(db, `incidents/${incidentId}/confronter_uid`),
      (current) => (current === userId ? null : undefined),
    );
  }

  await update(ref(db, `incident_members/${incidentId}/${userId}`), { role });
  await _checkReady(incidentId);
  await _writeSummary(incidentId);
}

export async function triggerGo(incidentId: string): Promise<void> {
  // Group size right now, for the resolved metric.
  const membersSnap = await get(ref(db, `incident_members/${incidentId}`));
  const memberCount = membersSnap.exists() ? Object.keys(membersSnap.val()).length : 0;

  // Flip to 'go' only on the first open/ready -> go transition, so the
  // resolved metric is counted exactly once even if Go is tapped twice.
  const tx = await runTransaction(ref(db, `incidents/${incidentId}/status`), (current) =>
    current === 'open' || current === 'ready' ? 'go' : undefined,
  );
  if (!tx.committed) return;

  await update(ref(db, `incidents/${incidentId}`), { go_at: Date.now() });

  // "Resolved" = the group reached the confrontation step. Record it once, here.
  const incidentSnap = await get(ref(db, `incidents/${incidentId}`));
  const incident = incidentSnap.exists() ? (incidentSnap.val() as Record<string, unknown>) : {};
  await _recordResolved(incident, memberCount);

  await _writeSummary(incidentId);
}

export async function leaveIncident(incidentId: string): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  const membersSnap = await get(ref(db, `incident_members/${incidentId}`));
  const members = membersSnap.exists()
    ? (membersSnap.val() as Record<string, { role?: string }>)
    : {};
  const others = Object.keys(members).filter((id) => id !== userId);

  // If I'm the last one here, the incident dissolves. This whole-incident
  // delete is allowed because, at this instant, I'm still a member.
  if (others.length === 0) {
    await _deleteIncidentData(incidentId);
    return;
  }

  // Others remain. Do everything in ONE atomic write, so it's all authorized
  // while I'm still a member: remove myself, tick the dot's head count down,
  // revert the group if it can no longer be "ready," and release the
  // confronter slot if I was holding it.
  const incidentSnap = await get(ref(db, `incidents/${incidentId}`));
  const incident = incidentSnap.exists() ? (incidentSnap.val() as Record<string, unknown>) : null;

  const updates: Record<string, unknown> = {
    [`incident_members/${incidentId}/${userId}`]: null,
    [`incident_summaries/${incidentId}/member_count`]: others.length,
    [`incident_summaries/${incidentId}/updated_at`]: Date.now(),
  };

  // If the people left behind can no longer form a ready group (need a
  // confronter and at least one partner) and we aren't mid-confrontation,
  // drop the incident back to "open".
  const remainingRoles = others.map((id) => members[id]?.role);
  const stillReady =
    remainingRoles.includes('confronter') && remainingRoles.some((r) => r === 'partner');
  if (incident && incident.status === 'ready' && !stillReady) {
    updates[`incidents/${incidentId}/status`] = 'open';
    updates[`incident_summaries/${incidentId}/status`] = 'open';
  }

  if (incident && incident.confronter_uid === userId) {
    updates[`incidents/${incidentId}/confronter_uid`] = null;
  }

  await update(ref(db), updates);
}

export async function getIncident(incidentId: string): Promise<Incident | null> {
  const snap = await get(ref(db, `incidents/${incidentId}`));
  if (!snap.exists()) return null;
  const d = snap.val();
  return {
    id: incidentId,
    description: d.description ?? null,
    geohash: d.geohash,
    status: d.status,
    expires_at: new Date(d.expires_at).toISOString(),
    last_lat: d.last_lat ?? null,
    last_lng: d.last_lng ?? null,
    go_at: d.go_at ? new Date(d.go_at).toISOString() : null,
    created_at: new Date(d.created_at).toISOString(),
  };
}

export async function getIncidentMembers(
  incidentId: string,
): Promise<IncidentMember[]> {
  const [membersSnap, profilesSnap] = await Promise.all([
    get(ref(db, `incident_members/${incidentId}`)),
    get(ref(db, 'profiles')),
  ]);

  if (!membersSnap.exists()) return [];

  const profiles: Record<string, { display_name: string; shirt_color?: string | null }> =
    profilesSnap.exists() ? profilesSnap.val() : {};

  return Object.entries(membersSnap.val() as Record<string, Record<string, unknown>>)
    .map(([memberUserId, m]) => ({
      id: `${incidentId}_${memberUserId}`,
      incident_id: incidentId,
      user_id: memberUserId,
      role: m.role as MemberRole,
      last_lat: (m.last_lat as number | null) ?? null,
      last_lng: (m.last_lng as number | null) ?? null,
      heading: (m.heading as number | null) ?? null,
      speed: (m.speed as number | null) ?? null,
      joined_at: new Date(m.joined_at as number).toISOString(),
      profile: profiles[memberUserId]
        ? {
            id: memberUserId,
            display_name: profiles[memberUserId].display_name,
            shirt_color: profiles[memberUserId].shirt_color ?? null,
          }
        : undefined,
    }))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}

export function subscribeToIncident(
  incidentId: string,
  onChange: () => void,
): () => void {
  const incidentRef = ref(db, `incidents/${incidentId}`);
  const membersRef = ref(db, `incident_members/${incidentId}`);

  const unsubIncident = onValue(incidentRef, onChange);
  const unsubMembers = onValue(membersRef, onChange);

  return () => {
    unsubIncident();
    unsubMembers();
  };
}

export function countOthers(members: IncidentMember[], userId: string): number {
  return members.filter((m) => m.user_id !== userId).length;
}

export function getConfronter(members: IncidentMember[]): IncidentMember | undefined {
  return members.find((m) => m.role === 'confronter');
}

export function countPartners(members: IncidentMember[]): number {
  return members.filter((m) => m.role === 'partner').length;
}

export function isReadyGroup(members: IncidentMember[]): boolean {
  return Boolean(getConfronter(members)) && countPartners(members) >= 1;
}