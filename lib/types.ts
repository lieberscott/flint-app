export type IncidentStatus = 'open' | 'ready' | 'go' | 'closed';
export type MemberRole = 'bothered' | 'confronter' | 'partner';

export type Profile = {
  id: string;
  display_name: string;
  shirt_color: string | null;
};

export type Incident = {
  id: string;
  description: string | null;
  geohash: string;
  status: IncidentStatus;
  expires_at: string;
  last_lat: number | null;
  last_lng: number | null;
  go_at: string | null;
  created_at: string;
};

export type IncidentMember = {
  id: string;
  incident_id: string;
  user_id: string;
  role: MemberRole;
  last_lat: number | null;
  last_lng: number | null;
  heading: number | null;
  speed: number | null;
  joined_at: string;
  profile?: Profile;
};

export type MatchIncidentResponse = {
  incident_id: string;
  member_count: number;
  others_count: number;
  status: IncidentStatus;
};

export const SHIRT_COLORS = ['black', 'white', 'red', 'blue', 'green', 'other'] as const;

export const CONFRONTER_SCRIPT =
  'Excuse me — would you mind using headphones? It\'s disturbing people nearby.';

export const PARTNER_SCRIPT = 'Yeah, we\'d really appreciate that.';