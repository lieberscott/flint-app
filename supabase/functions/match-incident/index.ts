import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type MatchRequest = {
  action: 'join' | 'ping';
  transit_line: string;
  direction: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  car_number?: string | null;
  incident_id?: string;
};

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) + 1;
        minLng = mid;
      } else {
        ch = (ch << 1) + 0;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) + 1;
        minLat = mid;
      } else {
        ch = (ch << 1) + 0;
        maxLat = mid;
      }
    }

    isLng = !isLng;
    bit += 1;

    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function headingDiff(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null || b == null) {
    return 0;
  }
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function movementMatches(
  lat: number,
  lng: number,
  heading: number | null | undefined,
  speed: number | null | undefined,
  incidentLat: number | null,
  incidentLng: number | null,
  memberLat: number | null,
  memberLng: number | null,
  memberHeading: number | null,
  memberSpeed: number | null,
): boolean {
  const refLat = memberLat ?? incidentLat;
  const refLng = memberLng ?? incidentLng;
  if (refLat == null || refLng == null) {
    return true;
  }

  const distance = haversineMeters(lat, lng, refLat, refLng);
  if (distance > 50) {
    return false;
  }

  const headingDelta = headingDiff(heading, memberHeading);
  if (heading != null && memberHeading != null && headingDelta > 20) {
    return false;
  }

  const speedDelta = Math.abs((speed ?? 0) - (memberSpeed ?? 0));
  if (speed != null && memberSpeed != null && speedDelta > 3) {
    return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as MatchRequest;
    const userId = userData.user.id;
    const geohash = encodeGeohash(body.lat, body.lng, 7);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    if (body.action === 'join') {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const { count: recentJoins } = await admin
        .from('incident_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('joined_at', oneHourAgo);

      if ((recentJoins ?? 0) >= 3) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let incidentId = body.incident_id ?? null;

    if (body.action === 'join' && !incidentId) {
      const { data: candidates } = await admin
        .from('incidents')
        .select('id, last_lat, last_lng, car_number')
        .eq('transit_line', body.transit_line)
        .eq('direction', body.direction)
        .in('status', ['open', 'ready'])
        .gt('expires_at', now.toISOString());

      let matchedId: string | null = null;

      for (const candidate of candidates ?? []) {
        if (body.car_number && candidate.car_number && candidate.car_number !== body.car_number) {
          continue;
        }

        if (candidate.last_lat == null || candidate.last_lng == null) {
          continue;
        }

        const distance = haversineMeters(body.lat, body.lng, candidate.last_lat, candidate.last_lng);
        if (distance > 200) {
          continue;
        }

        const { data: members } = await admin
          .from('incident_members')
          .select('last_lat, last_lng, heading, speed')
          .eq('incident_id', candidate.id)
          .order('joined_at', { ascending: false })
          .limit(1);

        const member = members?.[0];
        if (
          movementMatches(
            body.lat,
            body.lng,
            body.heading,
            body.speed,
            candidate.last_lat,
            candidate.last_lng,
            member?.last_lat ?? null,
            member?.last_lng ?? null,
            member?.heading ?? null,
            member?.speed ?? null,
          )
        ) {
          matchedId = candidate.id;
          break;
        }
      }

      if (matchedId) {
        incidentId = matchedId;
      } else {
        const { data: created, error: createError } = await admin
          .from('incidents')
          .insert({
            transit_line: body.transit_line,
            direction: body.direction,
            geohash,
            car_number: body.car_number ?? null,
            status: 'open',
            expires_at: expiresAt,
            last_lat: body.lat,
            last_lng: body.lng,
          })
          .select('id')
          .single();

        if (createError || !created) {
          throw createError ?? new Error('Failed to create incident');
        }

        incidentId = created.id;
      }
    }

    if (!incidentId) {
      return new Response(JSON.stringify({ error: 'incident_id required for ping' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: memberError } = await admin.from('incident_members').upsert(
      {
        incident_id: incidentId,
        user_id: userId,
        last_lat: body.lat,
        last_lng: body.lng,
        heading: body.heading ?? null,
        speed: body.speed ?? null,
      },
      { onConflict: 'incident_id,user_id' },
    );

    if (memberError) {
      throw memberError;
    }

    await admin
      .from('incidents')
      .update({
        last_lat: body.lat,
        last_lng: body.lng,
        expires_at: expiresAt,
      })
      .eq('id', incidentId);

    const { count: memberCount } = await admin
      .from('incident_members')
      .select('*', { count: 'exact', head: true })
      .eq('incident_id', incidentId);

    const { data: incident } = await admin
      .from('incidents')
      .select('status')
      .eq('id', incidentId)
      .single();

    return new Response(
      JSON.stringify({
        incident_id: incidentId,
        member_count: memberCount ?? 1,
        others_count: Math.max((memberCount ?? 1) - 1, 0),
        status: incident?.status ?? 'open',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
