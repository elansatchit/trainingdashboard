import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

interface WellnessRow {
  date: string | Date;
  sleep_hrs: number | null;
  hrv: number | null;
  resting_hr: number | null;
  readiness: number | null;
}

interface ActivityRow {
  id: number;
  date: string | Date;
  sport: string;
  name: string;
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  avg_watts: number | null;
  tss: number | null;
}

function toDateStr(d: string | Date): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - dow);
  return mon.toISOString().slice(0, 10);
}

export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);

  const [rows, wellnessRows] = await Promise.all([
    sql`
      SELECT id, date, sport, name, duration_min, distance_km, avg_hr, avg_watts, tss
      FROM activities ORDER BY date ASC
    ` as unknown as Promise<ActivityRow[]>,
    sql`
      SELECT date, sleep_hrs, hrv, resting_hr, readiness
      FROM wellness ORDER BY date DESC LIMIT 7
    `.catch(() => []) as Promise<WellnessRow[]>,
  ]);

  // --- CTL / ATL / TSB ---
  const dailyTss: Record<string, number> = {};
  for (const row of rows) {
    const d = toDateStr(row.date);
    dailyTss[d] = (dailyTss[d] ?? 0) + (row.tss ?? 0);
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const startStr = rows.length > 0 ? toDateStr(rows[0].date) : todayStr;

  const fitness: { date: string; ctl: number; atl: number; tsb: number; tss: number }[] = [];
  let ctl = 0;
  let atl = 0;

  const cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(todayStr + 'T00:00:00Z');
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    const tss = dailyTss[dateStr] ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    fitness.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // CTL change over last 7 days (ramp rate)
  const ctlNow = fitness.at(-1)?.ctl ?? 0;
  const ctl7ago = fitness.at(-8)?.ctl ?? ctlNow;
  const ctlChange = Math.round((ctlNow - ctl7ago) * 10) / 10;

  // --- Weekly volume (last 8 weeks) ---
  const eightWeeksAgo = new Date(Date.now() - 56 * 86400 * 1000)
    .toISOString().slice(0, 10);

  const weekMap: Record<string, { swim: number; bike: number; run: number }> = {};
  for (const row of rows) {
    const d = toDateStr(row.date);
    if (d < eightWeeksAgo) continue;
    const wk = weekKey(d);
    if (!weekMap[wk]) weekMap[wk] = { swim: 0, bike: 0, run: 0 };
    const sport = row.sport as 'swim' | 'bike' | 'run';
    if (sport in weekMap[wk]) weekMap[wk][sport] += row.duration_min ?? 0;
  }

  const weeklyVolume = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, ...v }));

  // --- This week vs last week ---
  const thisWeekKey = weekKey(todayStr);
  const lastWeekDate = new Date(todayStr + 'T00:00:00Z');
  lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7);
  const lastWeekKey = weekKey(lastWeekDate.toISOString().slice(0, 10));

  const thisWeek = weekMap[thisWeekKey] ?? { swim: 0, bike: 0, run: 0 };
  const lastWeek = weekMap[lastWeekKey] ?? { swim: 0, bike: 0, run: 0 };
  const thisWeekTotal = thisWeek.swim + thisWeek.bike + thisWeek.run;
  const lastWeekTotal = lastWeek.swim + lastWeek.bike + lastWeek.run;

  // --- Training days in last 30 days ---
  const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const activeDays = new Set(
    rows.filter((r) => toDateStr(r.date) >= thirtyAgo).map((r) => toDateStr(r.date))
  );

  // --- 4-week rolling totals by sport ---
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10);
  const rolling28 = { swim: 0, bike: 0, run: 0, swimDist: 0, bikeDist: 0, runDist: 0 };
  for (const row of rows) {
    const d = toDateStr(row.date);
    if (d < fourWeeksAgo) continue;
    const sport = row.sport as 'swim' | 'bike' | 'run';
    if (sport in rolling28) {
      rolling28[sport] += row.duration_min ?? 0;
      const distKey = `${sport}Dist` as 'swimDist' | 'bikeDist' | 'runDist';
      rolling28[distKey] += row.distance_km ?? 0;
    }
  }

  // --- Recent activities (last 14) ---
  const recentActivities = rows
    .slice(-14)
    .reverse()
    .map((r) => ({
      id: r.id,
      date: toDateStr(r.date),
      sport: r.sport,
      name: r.name,
      duration_min: r.duration_min,
      distance_km: r.distance_km,
      avg_hr: r.avg_hr,
      avg_watts: r.avg_watts,
      tss: r.tss,
    }));

  const last90 = fitness.slice(-90);
  const current = fitness.at(-1) ?? { date: todayStr, ctl: 0, atl: 0, tsb: 0, tss: 0 };

  // Wellness — most recent entry first
  const wellness = (wellnessRows as WellnessRow[]).map((w) => ({
    date: toDateStr(w.date),
    sleep_hrs: w.sleep_hrs,
    hrv: w.hrv,
    resting_hr: w.resting_hr,
    readiness: w.readiness,
  }));

  return NextResponse.json({
    fitness: last90,
    weeklyVolume,
    current,
    ctlChange,
    thisWeek: { ...thisWeek, total: thisWeekTotal },
    lastWeek: { ...lastWeek, total: lastWeekTotal },
    trainingDays30: activeDays.size,
    rolling28,
    recentActivities,
    wellness,
  });
}
