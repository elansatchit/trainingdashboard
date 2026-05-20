import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { neon } from '@neondatabase/serverless';

interface ActivityRow {
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

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

async function buildContext(): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);

  const [rows, wellnessRows] = await Promise.all([
    sql`
      SELECT date, sport, name, duration_min, distance_km, avg_hr, avg_watts, tss
      FROM activities ORDER BY date ASC
    ` as unknown as Promise<ActivityRow[]>,
    sql`
      SELECT date, sleep_hrs, hrv, resting_hr, readiness
      FROM wellness ORDER BY date DESC LIMIT 7
    ` as unknown as Promise<{ date: string | Date; sleep_hrs: number | null; hrv: number | null; resting_hr: number | null; readiness: number | null }[]>,
  ]);

  // CTL/ATL/TSB
  const dailyTss: Record<string, number> = {};
  for (const row of rows) {
    const d = toDateStr(row.date);
    dailyTss[d] = (dailyTss[d] ?? 0) + (row.tss ?? 0);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const startStr = rows.length > 0 ? toDateStr(rows[0].date) : todayStr;

  let ctl = 0, atl = 0;
  const cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(todayStr + 'T00:00:00Z');
  while (cur <= end) {
    const d = cur.toISOString().slice(0, 10);
    const tss = dailyTss[d] ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  const tsb = ctl - atl;
  const tsbStatus = tsb > 5 ? 'Fresh' : tsb >= -10 ? 'Neutral' : tsb >= -25 ? 'In Training' : 'Overreached';

  // Recent 14 days of activities
  const fourteenAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);
  const recent = (rows as ActivityRow[])
    .filter((r) => toDateStr(r.date) >= fourteenAgo)
    .map((r) => {
      const parts = [toDateStr(r.date), r.sport, r.name, fmtMins(r.duration_min)];
      if (r.distance_km) parts.push(`${r.distance_km}km`);
      if (r.avg_hr) parts.push(`${r.avg_hr}bpm`);
      if (r.avg_watts) parts.push(`${Math.round(r.avg_watts as number)}W`);
      if (r.tss) parts.push(`TSS:${r.tss}`);
      return parts.join(' | ');
    });

  // Weekly volume last 4 weeks
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10);
  const weekMap: Record<string, { swim: number; bike: number; run: number }> = {};
  for (const row of rows) {
    const d = toDateStr(row.date);
    if (d < fourWeeksAgo) continue;
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const offset = dow === 0 ? 6 : dow - 1;
    const mon = new Date(d + 'T00:00:00Z');
    mon.setUTCDate(mon.getUTCDate() - offset);
    const wk = mon.toISOString().slice(0, 10);
    if (!weekMap[wk]) weekMap[wk] = { swim: 0, bike: 0, run: 0 };
    const sport = row.sport as 'swim' | 'bike' | 'run';
    if (sport in weekMap[wk]) weekMap[wk][sport] += row.duration_min ?? 0;
  }
  const weeklyLines = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([wk, v]) => `Week of ${wk}: swim ${fmtMins(v.swim)}, bike ${fmtMins(v.bike)}, run ${fmtMins(v.run)}`);

  // Wellness
  const wellnessLines = wellnessRows.map((w) => {
    const parts = [`${toDateStr(w.date)}:`];
    if (w.sleep_hrs != null) parts.push(`sleep ${w.sleep_hrs}h`);
    if (w.hrv != null) parts.push(`HRV ${w.hrv}ms`);
    if (w.resting_hr != null) parts.push(`resting HR ${w.resting_hr}bpm`);
    if (w.readiness != null) parts.push(`body battery ${w.readiness}`);
    return parts.join(' ');
  });

  return `Today: ${todayStr}
Athlete goal: Ironman triathlon

CURRENT FITNESS (TrainingPeaks model):
CTL (Fitness): ${ctl.toFixed(1)}
ATL (Fatigue): ${atl.toFixed(1)}
TSB (Form): ${tsb >= 0 ? '+' : ''}${tsb.toFixed(1)} — ${tsbStatus}

RECENT ACTIVITIES (last 14 days):
${recent.length > 0 ? recent.join('\n') : 'None.'}

WEEKLY TRAINING VOLUME (last 4 weeks):
${weeklyLines.length > 0 ? weeklyLines.join('\n') : 'No data.'}

RECENT WELLNESS (Garmin):
${wellnessLines.length > 0 ? wellnessLines.join('\n') : 'No wellness data yet.'}`;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json() as {
    messages: { role: 'user' | 'assistant'; content: string }[];
  };

  const context = await buildContext();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: `You are a triathlon coach assistant with access to this athlete's real training data. Answer questions concisely and specifically using the data provided. Focus on actionable insights.\n\n${context}`,
  });

  // Gemini uses "model" not "assistant"
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user' as 'user' | 'model',
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages.at(-1)!.content;

  const chat = model.startChat({ history });
  const result = await chat.sendMessageStream(lastMessage);

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
