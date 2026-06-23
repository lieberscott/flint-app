// lib/incidents.ts
import {
  ref,
  get,
  set,
  update,
  push,
  onValue,
} from 'firebase/database';
import { auth, db } from './firebase';
import { encodeGeohash } from './location';
import type { IncidentContext, NearbyCluster } from './map';
import type {
  Incident,
  IncidentMember,
  MatchIncidentResponse,
  MemberRole,
} from './types';

export type { NearbyCluster } from './map';

const PROXIMITY_METERS = 50;
const MOVEMENT_SPEED_THRESHOLD = 2;

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
  if (haversineMeters(lat, lng, refLat, refLng) > PROXIMITY_METERS) return false;

  const moving = (speed ?? 0) > MOVEMENT_SPEED_THRESHOLD || (refSpeed ?? 0) > MOVEMENT_SPEED_THRESHOLD;
  if (!moving) {
    return true;
  }

  if (heading != null && refHeading != null && headingDiff(heading, refHeading) > 20) return false;
  if (speed != null && refSpeed != null && Math.abs(speed - refSpeed) > 3) return false;
  return true;
}

function transitMatches(
  context: IncidentContext | undefined,
  incident: Record<string, unknown>,
): boolean {
  const reporterLine = context?.transitLine?.trim();
  const reporterDirection = context?.direction?.trim();
  const reporterCar = context?.carNumber?.trim();

  const incidentLine = typeof incident.transit_line === 'string' ? incident.transit_line.trim() : '';
  const incidentDirection = typeof incident.direction === 'string' ? incident.direction.trim() : '';
  const incidentCar = typeof incident.car_number === 'string' ? incident.car_number.trim() : '';

  if (reporterLine && incidentLine && reporterLine !== incidentLine) return false;
  if (reporterDirection && incidentDirection && reporterDirection !== incidentDirection) return false;
  if (reporterCar && incidentCar && reporterCar !== incidentCar) return false;

  return true;
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

async function findMatchingIncident(
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  context?: IncidentContext,
): Promise<string | null> {
  const now = Date.now();
  const incidentsSnap = await get(ref(db, 'incidents'));
  if (!incidentsSnap.exists()) {
    return null;
  }

  const incidents = incidentsSnap.val() as Record<string, Record<string, unknown>>;
  for (const [id, incident] of Object.entries(incidents)) {
    if (!isJoinableIncident(incident, now)) continue;
    if (!transitMatches(context, incident)) continue;

    const matches = movementMatches(
      lat,
      lng,
      heading,
      speed,
      Number(incident.last_lat),
      Number(incident.last_lng),
      (incident.last_heading as number | null) ?? null,
      (incident.last_speed as number | null) ?? null,
    );

    if (matches) {
      return id;
    }
  }

  return null;
}

export async function reportNuisance(
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  context?: IncidentContext,
): Promise<MatchIncidentResponse> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  await checkRateLimit(userId);

  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const geohash = encodeGeohash(lat, lng, 7);

  const matchedId = await findMatchingIncident(lat, lng, heading, speed, context);
  let incidentId: string;

  if (matchedId) {
    incidentId = matchedId;
  } else {
    const newRef = push(ref(db, 'incidents'));
    incidentId = newRef.key!;
    await set(newRef, {
      transit_line: context?.transitLine?.trim() || null,
      direction: context?.direction?.trim() || null,
      geohash,
      car_number: context?.carNumber?.trim() || null,
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

export async function joinIncident(
  incidentId: string,
  lat: number,
  lng: number,
  heading: number | null,
  speed: number | null,
  context?: IncidentContext,
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

  if (!transitMatches(context, incident)) {
    throw new Error('Transit details do not match this report');
  }

  const matches = movementMatches(
    lat,
    lng,
    heading,
    speed,
    Number(incident.last_lat),
    Number(incident.last_lng),
    (incident.last_heading as number | null) ?? null,
    (incident.last_speed as number | null) ?? null,
  );

  if (!matches) {
    throw new Error('You are too far from this report to join');
  }

  const expiresAt = now + 10 * 60 * 1000;
  await _upsertMember(incidentId, userId, lat, lng, heading, speed);
  await _refreshExpiry(incidentId, lat, lng, heading, speed, expiresAt);
  await _checkReady(incidentId);

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

async function _memberCount(incidentId: string): Promise<number> {
  const snap = await get(ref(db, `incident_members/${incidentId}`));
  if (!snap.exists()) return 0;
  return Object.keys(snap.val()).length;
}

export async function listNearbyIncidents(
  lat: number,
  lng: number,
  radiusMeters = 200,
): Promise<NearbyCluster[]> {
  const now = Date.now();
  const incidentsSnap = await get(ref(db, 'incidents'));
  if (!incidentsSnap.exists()) {
    return [];
  }

  const incidents = incidentsSnap.val() as Record<string, Record<string, unknown>>;
  const clusters: NearbyCluster[] = [];

  for (const [incidentId, incident] of Object.entries(incidents)) {
    if (!isJoinableIncident(incident, now)) continue;

    const incidentLat = Number(incident.last_lat);
    const incidentLng = Number(incident.last_lng);
    const distance = haversineMeters(lat, lng, incidentLat, incidentLng);
    if (distance > radiusMeters) continue;

    const memberCount = await _memberCount(incidentId);
    if (memberCount === 0) continue;

    clusters.push({
      incidentId,
      lat: incidentLat,
      lng: incidentLng,
      memberCount,
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
  const incidentsRef = ref(db, 'incidents');
  const membersRef = ref(db, 'incident_members');

  let active = true;

  const refresh = async () => {
    if (!active) return;
    const clusters = await listNearbyIncidents(lat, lng, radiusMeters);
    onChange(clusters);
  };

  void refresh();
  const unsubIncidents = onValue(incidentsRef, () => {
    void refresh();
  });
  const unsubMembers = onValue(membersRef, () => {
    void refresh();
  });

  return () => {
    active = false;
    unsubIncidents();
    unsubMembers();
  };
}

export async function setMemberRole(
  incidentId: string,
  role: MemberRole,
): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not signed in');

  if (role === 'confronter') {
    const snap = await get(ref(db, `incident_members/${incidentId}`));
    if (snap.exists()) {
      const members: Record<string, { role: MemberRole }> = snap.val();
      const hasOtherConfronter = Object.entries(members).some(
        ([id, m]) => m.role === 'confronter' && id !== userId,
      );
      if (hasOtherConfronter) {
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
    transit_line: d.transit_line ?? null,
    direction: d.direction ?? null,
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
