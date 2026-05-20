import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

async function getAccessToken(): Promise<string> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

function mapSport(stravaType: string): string {
  const map: Record<string, string> = {
    Swim: 'swim',
    Ride: 'bike',
    VirtualRide: 'bike',
    EBikeRide: 'bike',
    Run: 'run',
    Walk: 'run',
    TrailRun: 'run',
    Hike: 'run',
  };
  return map[stravaType] ?? stravaType.toLowerCase();
}

// Estimate TSS: cycling uses watts vs FTP, others fall back to suffer_score
function estimateTss(act: Record<string, unknown>): number | null {
  const sport = mapSport((act.sport_type ?? act.type) as string);
  const durationHr = (act.moving_time as number) / 3600;

  if (sport === 'bike' && act.average_watts) {
    const ftp = parseInt(process.env.ATHLETE_FTP ?? '250');
    const if_ = (act.average_watts as number) / ftp;
    return Math.round(durationHr * if_ * if_ * 100);
  }

  if (typeof act.suffer_score === 'number') return act.suffer_score;
  return null;
}

async function fetchAllActivities(
  accessToken: string,
  after: number
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${STRAVA_ACTIVITIES_URL}?after=${after}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Activities fetch failed: ${res.status} ${text}`);
    }
    const batch = await res.json() as Record<string, unknown>[];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const accessToken = await getAccessToken();

    // Incremental: start from the most recent activity in DB, fall back to 90 days
    const [row] = await sql`SELECT MAX(date) as max_date FROM activities`;
    const after = row?.max_date
      ? Math.floor(new Date(row.max_date as string).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 90 * 24 * 3600;

    const activities = await fetchAllActivities(accessToken, after);

    for (const act of activities) {
      const date = (act.start_date as string).slice(0, 10);
      const sport = mapSport((act.sport_type ?? act.type) as string);
      const duration_min = Math.round((act.moving_time as number) / 60);
      const distance_km = act.distance
        ? Math.round((act.distance as number) / 10) / 100
        : null;
      const avg_hr = act.average_heartrate != null
        ? Math.round(act.average_heartrate as number)
        : null;
      const avg_watts = (act.average_watts as number | null) ?? null;
      const tss = estimateTss(act);

      await sql`
        INSERT INTO activities (id, date, sport, name, duration_min, distance_km, avg_hr, avg_watts, tss, raw)
        VALUES (
          ${act.id as number},
          ${date},
          ${sport},
          ${act.name as string},
          ${duration_min},
          ${distance_km},
          ${avg_hr},
          ${avg_watts},
          ${tss},
          ${JSON.stringify(act)}
        )
        ON CONFLICT (id) DO UPDATE SET
          date         = EXCLUDED.date,
          sport        = EXCLUDED.sport,
          name         = EXCLUDED.name,
          duration_min = EXCLUDED.duration_min,
          distance_km  = EXCLUDED.distance_km,
          avg_hr       = EXCLUDED.avg_hr,
          avg_watts    = EXCLUDED.avg_watts,
          tss          = EXCLUDED.tss,
          raw          = EXCLUDED.raw
      `;
    }

    return NextResponse.json({ synced: activities.length });
  } catch (err) {
    console.error('[sync]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
