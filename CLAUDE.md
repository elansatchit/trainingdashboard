# Ironman Training Dashboard

Next.js (App Router, TypeScript, Tailwind) on Vercel. Repo: elansatchit/trainingdashboard.
A personal daily dashboard for Ironman training that pulls activities from Strava into
a Neon Postgres DB, and answers questions about the data via the Anthropic API.

## Env vars (in .env.local and Vercel — never commit)
- DATABASE_URL          # Neon pooled connection string
- STRAVA_CLIENT_ID
- STRAVA_CLIENT_SECRET
- STRAVA_REFRESH_TOKEN
- ANTHROPIC_API_KEY     # added later, for the chat route

## DB schema (already created in Neon)
- activities(id, date, sport, name, duration_min, distance_km, avg_hr, avg_watts, tss, raw)
- wellness(date, sleep_hrs, hrv, resting_hr, readiness)

## Done
- Repo pushed, deployed to Vercel
- app/api/sync/route.ts: refreshes Strava token, pulls activities, upserts into Neon
- @neondatabase/serverless installed

## To build next
1. Test /api/sync end to end (should return {synced: N})
2. app/api/data/route.ts: read activities, compute CTL (42-day EMA of daily TSS),
   ATL (7-day EMA), TSB (CTL-ATL), weekly volume by sport
3. Dashboard UI: React + Recharts — fitness/fatigue/form chart, recovery, weekly volume,
   metric tiles. (Reference design already drafted.)
4. app/api/chat/route.ts: proxy to api.anthropic.com (x-api-key from env), pass a compact
   data summary + the user's question, return Claude's answer
5. Vercel Cron to run /api/sync a couple times a day
6. Later: Garmin wellness (HRV, sleep, readiness) via a scheduled GitHub Action writing to the wellness table