# Flint

Minimal React Native app for transit riders to find others on the same train who are also bothered by loud phone audio, assign Confronter/Partner roles, and speak up together.

## Stack

- Expo + Expo Router (TypeScript)
- Supabase (anonymous auth, Postgres, Realtime, Edge Functions)
- `expo-location` for foreground GPS pings

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project at [supabase.com](https://supabase.com).

3. Enable **Anonymous sign-ins** in Supabase Auth settings.

4. Apply the database migration from [`supabase/migrations/20250615000000_init.sql`](supabase/migrations/20250615000000_init.sql) in the Supabase SQL editor (or via Supabase CLI).

5. Deploy the edge function:

```bash
supabase functions deploy match-incident
```

6. Copy env vars:

```bash
cp .env.example .env
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.

7. Start the app:

```bash
npm start
```

## App flow

1. **Setup** — first name, optional shirt color, location permission
2. **Home** — report nuisance, pick transit line/direction, see live count of others nearby
3. **Ready** — confronter taps Go, partners see backup prompt, anyone taps Done to close

Sessions expire after 10 minutes. Users are limited to 3 incident joins per hour.
