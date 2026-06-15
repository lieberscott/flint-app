// lib/incidents.ts
import {
  ref,
  get,
  set,
  update,
  push,
  onValue,
  serverTimestamp,
  query,
  orderByChild,
  equalTo,
} from 'firebase/database';
import { auth, db } from './firebase';
import { encodeGeohash } from './location';
import type {
  Incident,
  IncidentMember,
  MatchIncidentResponse,
  MemberRole,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function headingDiff(a: number | null, b: number | null): number {
  if (a == null || b == null) return 0;
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function movementMatches(
  lat: number, lng: number,
  heading: number | null, speed: number | null,
  refLat: number | null, refLng: number | null,
  refHeading: number | null, refSpeed: number | null,
): boolean {
  if (refLat == null || refLng == null) return true;
  if (haversineMeters(lat, lng, refLat, refLng) > 50) return false;
  if (heading != null && refHeading != null && headingDiff(heading, refHeading) > 20) return false;
  if (speed != null && refSpeed != null && Math.abs(speed - refSpeed) > 3) return false;
  return true;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(userId: string): Promise<void> {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const snap = await get(ref(db, `rate_limits/${userId}`));
  if (snap.exists()) {
    const timestamps: number[] = Object.values(snap.val());
    const recent = timestamps.filter((t) => t > oneHourAgo);
    if (recent.length >= 3) {
      throw new Error('Rate limit exceeded — max 3 reports per hour.');
    }
  }
}

async function recordRateLimit(userId: string): Promise<void> {
  await push(ref(db, `rate_limits/${userId}`), Date.now());
}

// ─── Core match function (replaces the Supabase Edge Function) ───────────────

export async function reportNuisance(
  transitLine: string,
  direction: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  carNumber: string | null,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  await checkRateLimit(userId);

  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const geohash = encodeGeohash(lat, lng, 7);

  // Look for an existing open incident on the same line/direction
  const incidentsSnap = await get(ref(db, 'incidents'));
  let matchedId: string | null = null;

  if (incidentsSnap.exists()) {
    const incidents = incidentsSnap.val() as Record<string, any>;
    for (const [id, incident] of Object.entries(incidents)) {
      if (incident.transit_line !== transitLine.trim()) continue;
      if (incident.direction !== direction.trim()) continue;
      if (!['open', 'ready'].includes(incident.status)) continue;
      if (incident.expires_at < now) continue;
      if (carNumber && incident.car_number && incident.car_number !== carNumber) continue;

      const matches = movementMatches(
        lat, lng, heading, speed,
        incident.last_lat, incident.last_lng,
        incident.last_heading, incident.last_speed,
      );

      if (matches) {
        matchedId = id;
        break;
      }
    }
  }

  let incidentId: string;

  if (matchedId) {
    incidentId = matchedId;
  } else {
    // Create a new incident
    const newRef = push(ref(db, 'incidents'));
    incidentId = newRef.key!;
    await set(newRef, {
      transit_line: transitLine.trim(),
      direction: direction.trim(),
      geohash,
      car_number: carNumber ?? null,
      status: 'open',
      expires_at: expiresAt,
      last_lat: lat,
      last_lng: lng,
      last_heading: heading,
      last_speed: speed,
      created_at: now,
    });
  }

  await recordRateLimit(userId);
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);
  await _checkReady(incidentId);

  return _buildResponse(incidentId, userId);
}

export async function pingIncident(
  incidentId: string,
  _transitLine: string,
  _direction: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  _carNumber: string | null,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  const expiresAt = Date.now() + 10 * 60 * 1000;
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);

  return _buildResponse(incidentId, userId);
}

// ─── Private helpers ─────────────────────────────────────────────────────────

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
    expires_at: expiresAt,
  });
}

async function _checkReady(incidentId: string): Promise<void> {
  const snap = await get(ref(db, `incident_members/${incidentId}`));
  if (!snap.exists()) return;

  const members: Record<string, any> = snap.val();
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

// ─── Public incident actions ─────────────────────────────────────────────────

export async function setMemberRole(
  incidentId: string,
  role: MemberRole,
): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  if (role === 'confronter') {
    const snap = await get(ref(db, `incident_members/${incidentId}`));
    if (snap.exists()) {
      const members: Record<string, any> = snap.val();
      const alreadyHasConfronter = Object.values(members).some(
        (m) => m.role === 'confronter',
      );
      if (alreadyHasConfronter) {
        throw new Error('Someone is already the confronter');
      }
    }
  }

  await update(ref(db, `incident_members/${incidentId}/${userId}`), { role });
  await _checkReady(incidentId);
}

export async function triggerGo(incidentId: string): Promise<void> {
  await update(ref(db, `incidents/${incidentId}`), {
    status: 'go',
    go_at: Date.now(),
  });
}

export async function closeIncident(incidentId: string): Promise<void> {
  await update(ref(db, `incidents/${incidentId}`), { status: 'closed' });
}

export async function getIncident(incidentId: string): Promise<Incident | null> {
  const snap = await get(ref(db, `incidents/${incidentId}`));
  if (!snap.exists()) return null;
  const d = snap.val();
  return {
    id: incidentId,
    transit_line: d.transit_line,
    direction: d.direction,
    geohash: d.geohash,
    car_number: d.car_number ?? null,
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

  const profiles: Record<string, any> = profilesSnap.exists()
    ? profilesSnap.val()
    : {};

  return Object.entries(membersSnap.val() as Record<string, any>)
    .map(([userId, m]) => ({
      id: `${incidentId}_${userId}`,
      incident_id: incidentId,
      user_id: userId,
      role: m.role,
      last_lat: m.last_lat ?? null,
      last_lng: m.last_lng ?? null,
      heading: m.heading ?? null,
      speed: m.speed ?? null,
      joined_at: new Date(m.joined_at).toISOString(),
      profile: profiles[userId]
        ? {
            id: userId,
            display_name: profiles[userId].display_name,
            shirt_color: profiles[userId].shirt_color ?? null,
          }
        : undefined,
    }))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}

// ─── Realtime subscription (replaces Supabase postgres_changes) ──────────────

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

// ─── Pure utility helpers (used by screens) ──────────────────────────────────

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