"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface FitnessPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  tss: number;
}

interface WeekVolume {
  week: string;
  swim: number;
  bike: number;
  run: number;
}

interface RecentActivity {
  id: number;
  date: string;
  sport: string;
  name: string;
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  avg_watts: number | null;
  tss: number | null;
}

interface WellnessEntry {
  date: string;
  sleep_hrs: number | null;
  hrv: number | null;
  resting_hr: number | null;
  readiness: number | null;
}

interface ApiData {
  fitness: FitnessPoint[];
  weeklyVolume: WeekVolume[];
  current: FitnessPoint;
  ctlChange: number;
  thisWeek: { swim: number; bike: number; run: number; total: number };
  lastWeek: { swim: number; bike: number; run: number; total: number };
  trainingDays30: number;
  rolling28: { swim: number; bike: number; run: number; swimDist: number; bikeDist: number; runDist: number };
  recentActivities: RecentActivity[];
  wellness: WellnessEntry[];
}

interface VolumePoint extends WeekVolume {
  swimH: number;
  bikeH: number;
  runH: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SPORT_ICON: Record<string, string> = { swim: "🏊", bike: "🚴", run: "🏃" };
const SPORT_COLOR: Record<string, string> = {
  swim: "text-cyan-400",
  bike: "text-blue-400",
  run: "text-purple-400",
};

function tsbColor(tsb: number) {
  if (tsb > 5) return "text-green-400";
  if (tsb >= -10) return "text-yellow-400";
  if (tsb >= -25) return "text-orange-400";
  return "text-red-400";
}

function tsbLabel(tsb: number) {
  if (tsb > 5) return "Fresh";
  if (tsb >= -10) return "Neutral";
  if (tsb >= -25) return "In Training";
  return "Overreached";
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtMins(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtHours(mins: number) {
  return (mins / 60).toFixed(1) + "h";
}

function MetricTile({
  label,
  value,
  sub,
  color,
  badge,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  badge?: { text: string; positive: boolean } | null;
}) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <p className={`text-3xl font-bold tabular-nums ${color}`}>{value}</p>
        {badge && (
          <span
            className={`text-xs font-medium mb-1 px-1.5 py-0.5 rounded ${
              badge.positive
                ? "bg-green-900/50 text-green-400"
                : "bg-red-900/50 text-red-400"
            }`}
          >
            {badge.text}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

function SportTile({
  sport,
  mins,
  dist,
  prevMins,
}: {
  sport: string;
  mins: number;
  dist?: number;
  prevMins?: number;
}) {
  const icon = SPORT_ICON[sport] ?? "•";
  const color = SPORT_COLOR[sport] ?? "text-slate-300";
  const diff = prevMins !== undefined ? mins - prevMins : null;
  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex items-center gap-4">
      <span className="text-2xl">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wider capitalize">{sport}</p>
        <p className={`text-2xl font-bold tabular-nums ${color}`}>{fmtHours(mins)}</p>
        {dist !== undefined && dist > 0 && (
          <p className="text-xs text-slate-400">{dist.toFixed(1)} km</p>
        )}
      </div>
      {diff !== null && (
        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded self-start ${
            diff >= 0
              ? "bg-green-900/50 text-green-400"
              : "bg-red-900/50 text-red-400"
          }`}
        >
          {diff >= 0 ? "+" : ""}
          {fmtHours(diff)} vs last wk
        </span>
      )}
    </div>
  );
}

function FitnessTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
      <p className="text-slate-400 mb-2">{label ? fmtDate(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function VolumeTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
      <p className="text-slate-400 mb-2">Week of {label ? fmtDate(label) : ""}</p>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.name}: <span className="font-semibold">{fmtMins(Math.round(p.value * 60))}</span>
          </p>
        ))}
    </div>
  );
}

function ActivityRow({ act }: { act: RecentActivity }) {
  const icon = SPORT_ICON[act.sport] ?? "•";
  const color = SPORT_COLOR[act.sport] ?? "text-slate-300";
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-800 last:border-0">
      <span className="text-lg w-6 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{act.name}</p>
        <p className="text-xs text-slate-500">{fmtDate(act.date)}</p>
      </div>
      <div className="flex gap-4 text-xs tabular-nums flex-shrink-0">
        <span className={`font-medium ${color}`}>{fmtMins(act.duration_min)}</span>
        {act.distance_km != null && act.distance_km > 0 && (
          <span className="text-slate-400">{act.distance_km.toFixed(1)} km</span>
        )}
        {act.avg_hr != null && (
          <span className="text-slate-400">{act.avg_hr} bpm</span>
        )}
        {act.avg_watts != null && (
          <span className="text-slate-400">{act.avg_watts}W</span>
        )}
        {act.tss != null && (
          <span className="text-slate-500">TSS {act.tss}</span>
        )}
      </div>
    </div>
  );
}

function readinessColor(v: number) {
  if (v >= 75) return "text-green-400";
  if (v >= 50) return "text-yellow-400";
  if (v >= 25) return "text-orange-400";
  return "text-red-400";
}

function hrvColor(v: number) {
  if (v >= 60) return "text-green-400";
  if (v >= 45) return "text-yellow-400";
  if (v >= 30) return "text-orange-400";
  return "text-red-400";
}

function RecoverySection({ wellness }: { wellness: WellnessEntry[] }) {
  const latest = wellness[0] ?? null;

  if (!latest) {
    return (
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
        <h2 className="text-base font-semibold mb-1">Recovery</h2>
        <p className="text-xs text-slate-500 mb-4">Garmin wellness data</p>
        <p className="text-slate-600 text-sm text-center py-6">
          No wellness data yet — Garmin sync runs daily after setup.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Recovery</h2>
          <p className="text-xs text-slate-500">Garmin · {fmtDate(latest.date)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">HRV</p>
          <p className={`text-2xl font-bold tabular-nums ${latest.hrv != null ? hrvColor(latest.hrv) : "text-slate-600"}`}>
            {latest.hrv != null ? `${latest.hrv}` : "—"}
          </p>
          <p className="text-xs text-slate-500 mt-1">ms (last night)</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Sleep</p>
          <p className={`text-2xl font-bold tabular-nums ${latest.sleep_hrs != null ? (latest.sleep_hrs >= 7.5 ? "text-green-400" : latest.sleep_hrs >= 6 ? "text-yellow-400" : "text-red-400") : "text-slate-600"}`}>
            {latest.sleep_hrs != null ? `${latest.sleep_hrs}h` : "—"}
          </p>
          <p className="text-xs text-slate-500 mt-1">hours</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Resting HR</p>
          <p className={`text-2xl font-bold tabular-nums ${latest.resting_hr != null ? (latest.resting_hr <= 50 ? "text-green-400" : latest.resting_hr <= 60 ? "text-yellow-400" : "text-orange-400") : "text-slate-600"}`}>
            {latest.resting_hr != null ? `${latest.resting_hr}` : "—"}
          </p>
          <p className="text-xs text-slate-500 mt-1">bpm</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Body Battery</p>
          <p className={`text-2xl font-bold tabular-nums ${latest.readiness != null ? readinessColor(latest.readiness) : "text-slate-600"}`}>
            {latest.readiness != null ? `${latest.readiness}` : "—"}
          </p>
          <p className="text-xs text-slate-500 mt-1">out of 100</p>
        </div>
      </div>
      {wellness.length > 1 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-500 mb-2">Last 7 days</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {wellness.slice(0, 7).reverse().map((w) => (
              <div key={w.date} className="flex-shrink-0 text-center">
                <p className="text-xs text-slate-600">{fmtDate(w.date)}</p>
                <p className={`text-xs font-medium ${w.hrv != null ? hrvColor(w.hrv) : "text-slate-700"}`}>
                  {w.hrv != null ? `${w.hrv}ms` : "—"}
                </p>
                <p className={`text-xs ${w.sleep_hrs != null ? (w.sleep_hrs >= 7.5 ? "text-green-400" : "text-yellow-400") : "text-slate-700"}`}>
                  {w.sleep_hrs != null ? `${w.sleep_hrs}h` : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const assistantIdx = newMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = {
            role: "assistant",
            content: updated[assistantIdx].content + chunk,
          };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: "assistant",
          content: "Sorry, something went wrong.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col h-96">
      <div className="px-5 pt-4 pb-2 border-b border-slate-800 flex-shrink-0">
        <h2 className="text-base font-semibold">Ask Your Coach</h2>
        <p className="text-xs text-slate-500">Powered by Claude · uses your real training data</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="text-slate-600 text-xs text-center mt-8">
            Ask about your fitness, fatigue, training load, or what to do next.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-200"
              }`}
            >
              {m.content || <span className="text-slate-500 animate-pulse">▋</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 py-3 border-t border-slate-800 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Ask about your training…"
          disabled={streaming}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/data");
    setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync");
      const json = await res.json();
      setSyncMsg(
        json.synced !== undefined ? `Synced ${json.synced} activities` : "Sync failed"
      );
      await fetchData();
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-lg animate-pulse">Loading training data…</p>
      </div>
    );
  }

  const {
    fitness,
    weeklyVolume,
    current,
    ctlChange,
    thisWeek,
    lastWeek,
    trainingDays30,
    rolling28,
    recentActivities,
    wellness,
  } = data ?? {
    fitness: [],
    weeklyVolume: [],
    current: { date: "", ctl: 0, atl: 0, tsb: 0, tss: 0 },
    ctlChange: 0,
    thisWeek: { swim: 0, bike: 0, run: 0, total: 0 },
    lastWeek: { swim: 0, bike: 0, run: 0, total: 0 },
    trainingDays30: 0,
    rolling28: { swim: 0, bike: 0, run: 0, swimDist: 0, bikeDist: 0, runDist: 0 },
    recentActivities: [],
    wellness: [],
  };

  const volumeChart: VolumePoint[] = weeklyVolume.map((w) => ({
    ...w,
    swimH: parseFloat((w.swim / 60).toFixed(2)),
    bikeH: parseFloat((w.bike / 60).toFixed(2)),
    runH: parseFloat((w.run / 60).toFixed(2)),
  }));

  const tsbSign = current.tsb >= 0 ? "+" : "";
  const ctlSign = ctlChange >= 0 ? "+" : "";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Ironman Training Dashboard</h1>
          <p className="text-sm text-slate-400">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-sm text-slate-400">{syncMsg}</span>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {syncing ? "Syncing…" : "Sync Strava"}
          </button>
        </div>
      </header>

      <main className="px-6 py-6 space-y-6 max-w-7xl mx-auto">

        {/* Fitness metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricTile
            label="Fitness (CTL)"
            value={current.ctl.toFixed(1)}
            sub="42-day avg TSS"
            color="text-blue-400"
            badge={ctlChange !== 0 ? { text: `${ctlSign}${ctlChange} this wk`, positive: ctlChange >= 0 } : null}
          />
          <MetricTile
            label="Fatigue (ATL)"
            value={current.atl.toFixed(1)}
            sub="7-day avg TSS"
            color="text-orange-400"
          />
          <MetricTile
            label="Form (TSB)"
            value={`${tsbSign}${current.tsb.toFixed(1)}`}
            sub={tsbLabel(current.tsb)}
            color={tsbColor(current.tsb)}
          />
          <MetricTile
            label="Training Days"
            value={String(trainingDays30)}
            sub="last 30 days"
            color="text-slate-300"
          />
        </div>

        {/* This week summary */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold">This Week</h2>
            <span className="text-xs text-slate-500">
              Total {fmtHours(thisWeek.total)}
              {lastWeek.total > 0 && (
                <span className={thisWeek.total >= lastWeek.total ? " text-green-400" : " text-red-400"}>
                  {" "}({thisWeek.total >= lastWeek.total ? "+" : ""}
                  {fmtHours(thisWeek.total - lastWeek.total)} vs last week)
                </span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SportTile sport="swim" mins={thisWeek.swim} prevMins={lastWeek.swim} />
            <SportTile sport="bike" mins={thisWeek.bike} prevMins={lastWeek.bike} />
            <SportTile sport="run" mins={thisWeek.run} prevMins={lastWeek.run} />
          </div>
        </div>

        {/* 4-week rolling totals */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold">Last 4 Weeks</h2>
            <span className="text-xs text-slate-500">
              {fmtHours(rolling28.swim + rolling28.bike + rolling28.run)} total training
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SportTile sport="swim" mins={rolling28.swim} dist={rolling28.swimDist} />
            <SportTile sport="bike" mins={rolling28.bike} dist={rolling28.bikeDist} />
            <SportTile sport="run" mins={rolling28.run} dist={rolling28.runDist} />
          </div>
        </div>

        {/* Fitness / Fatigue / Form chart */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
          <h2 className="text-base font-semibold mb-1">Fitness · Fatigue · Form</h2>
          <p className="text-xs text-slate-500 mb-4">Last 90 days</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={fitness} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fill: "#64748b", fontSize: 11 }}
                interval={13}
              />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
              <Tooltip content={<FitnessTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(v) => <span style={{ color: "#94a3b8" }}>{v}</span>}
              />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="ctl" name="CTL (Fitness)" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="atl" name="ATL (Fatigue)" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="tsb" name="TSB (Form)" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly volume chart + recent activities side by side on wide screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weekly volume */}
          {volumeChart.length > 0 ? (
            <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
              <h2 className="text-base font-semibold mb-1">Weekly Training Volume</h2>
              <p className="text-xs text-slate-500 mb-4">Hours per sport</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={volumeChart} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={fmtDate}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <YAxis tickFormatter={(v) => `${v}h`} tick={{ fill: "#64748b", fontSize: 11 }} />
                  <Tooltip content={<VolumeTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                    formatter={(v) => <span style={{ color: "#94a3b8" }}>{v}</span>}
                  />
                  <Bar dataKey="swimH" name="Swim" stackId="a" fill="#06b6d4" />
                  <Bar dataKey="bikeH" name="Bike" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="runH" name="Run" stackId="a" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 flex items-center justify-center">
              <p className="text-slate-500 text-sm">No volume data yet.</p>
            </div>
          )}

          {/* Recent activities */}
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
            <h2 className="text-base font-semibold mb-1">Recent Activities</h2>
            <p className="text-xs text-slate-500 mb-4">Last 14 sessions</p>
            {recentActivities.length > 0 ? (
              <div className="overflow-y-auto max-h-64">
                {recentActivities.map((act) => (
                  <ActivityRow key={act.id} act={act} />
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm text-center py-8">
                No activities. Sync Strava to load data.
              </p>
            )}
          </div>
        </div>

        {/* Recovery / Garmin wellness */}
        <RecoverySection wellness={wellness} />

        {/* Chat */}
        <ChatPanel />
      </main>
    </div>
  );
}
