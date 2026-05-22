"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
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

const SPORT_ACCENT: Record<string, { text: string; glow: string; bar: string; border: string }> = {
  swim: { text: "#22d3ee", glow: "rgba(34,211,238,0.25)", bar: "from-cyan-500 to-cyan-400", border: "#22d3ee" },
  bike: { text: "#60a5fa", glow: "rgba(96,165,250,0.25)", bar: "from-blue-500 to-blue-400", border: "#60a5fa" },
  run:  { text: "#c084fc", glow: "rgba(192,132,252,0.25)", bar: "from-purple-500 to-purple-400", border: "#c084fc" },
};

function tsbColor(tsb: number): string {
  if (tsb > 5) return "#34d399";
  if (tsb >= -10) return "#fbbf24";
  if (tsb >= -25) return "#fb923c";
  return "#f87171";
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

// Card base style
const card = "rounded-2xl border border-[#1a2d50]/60 bg-[#0c1628]";

function MetricTile({
  label,
  value,
  sub,
  accentColor,
  glowColor,
  barClass,
  badge,
}: {
  label: string;
  value: string;
  sub: string;
  accentColor: string;
  glowColor: string;
  barClass: string;
  badge?: { text: string; positive: boolean } | null;
}) {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className={`h-[2px] bg-gradient-to-r ${barClass}`} />
      <div className="p-5">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">{label}</p>
        <div className="flex items-end gap-2 mb-1">
          <p
            className="text-4xl font-bold tabular-nums leading-none"
            style={{ color: accentColor, textShadow: `0 0 24px ${glowColor}` }}
          >
            {value}
          </p>
          {badge && (
            <span
              className="text-[10px] font-semibold mb-0.5 px-2 py-0.5 rounded-full"
              style={{
                background: badge.positive ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                color: badge.positive ? "#34d399" : "#f87171",
              }}
            >
              {badge.text}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-1">{sub}</p>
      </div>
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
  const accent = SPORT_ACCENT[sport] ?? { text: "#94a3b8", glow: "rgba(148,163,184,0.2)", bar: "from-slate-500 to-slate-400", border: "#94a3b8" };
  const diff = prevMins !== undefined ? mins - prevMins : null;

  return (
    <div className={`${card} overflow-hidden`}>
      <div className={`h-[2px] bg-gradient-to-r ${accent.bar}`} />
      <div className="p-4 flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: `${accent.glow}`, border: `1px solid ${accent.border}22` }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest capitalize mb-0.5">{sport}</p>
          <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: accent.text }}>
            {fmtHours(mins)}
          </p>
          {dist !== undefined && dist > 0 && (
            <p className="text-xs text-slate-600 mt-0.5">{dist.toFixed(1)} km</p>
          )}
        </div>
        {diff !== null && (
          <span
            className="text-[10px] font-semibold px-2 py-1 rounded-full self-start mt-1 flex-shrink-0"
            style={{
              background: diff >= 0 ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
              color: diff >= 0 ? "#34d399" : "#f87171",
            }}
          >
            {diff >= 0 ? "+" : ""}{fmtHours(diff)}
          </span>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  weekMode,
}: {
  active?: boolean;
  payload?: { dataKey: string; name: string; value: number; color: string }[];
  label?: string;
  weekMode?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[#1a2d50] bg-[#0a1220]/95 backdrop-blur p-3 text-sm shadow-2xl">
      <p className="text-slate-400 text-xs mb-2">{weekMode ? "Week of " : ""}{label ? fmtDate(label) : ""}</p>
      {payload
        .filter((p) => p.value !== 0 || !weekMode)
        .map((p) => (
          <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
            {p.name}:{" "}
            <span className="font-bold">
              {weekMode ? fmtMins(Math.round(p.value * 60)) : p.value}
            </span>
          </p>
        ))}
    </div>
  );
}

function ActivityRow({ act }: { act: RecentActivity }) {
  const icon = SPORT_ICON[act.sport] ?? "•";
  const accent = SPORT_ACCENT[act.sport] ?? { text: "#94a3b8" };
  return (
    <div className="flex items-center gap-3 py-3 border-b border-[#1a2d50]/40 last:border-0">
      <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{act.name}</p>
        <p className="text-xs text-slate-600">{fmtDate(act.date)}</p>
      </div>
      <div className="flex gap-3 text-xs tabular-nums flex-shrink-0">
        <span className="font-semibold" style={{ color: accent.text }}>{fmtMins(act.duration_min)}</span>
        {act.distance_km != null && act.distance_km > 0 && (
          <span className="text-slate-500">{act.distance_km.toFixed(1)} km</span>
        )}
        {act.avg_hr != null && (
          <span className="text-slate-500">{act.avg_hr} bpm</span>
        )}
        {act.avg_watts != null && (
          <span className="text-slate-500">{Math.round(act.avg_watts)}W</span>
        )}
        {act.tss != null && (
          <span className="text-slate-600">TSS {act.tss}</span>
        )}
      </div>
    </div>
  );
}

function wellnessValueColor(type: "hrv" | "sleep" | "hr" | "battery", v: number): string {
  if (type === "hrv") return v >= 60 ? "#34d399" : v >= 45 ? "#fbbf24" : v >= 30 ? "#fb923c" : "#f87171";
  if (type === "sleep") return v >= 7.5 ? "#34d399" : v >= 6 ? "#fbbf24" : "#f87171";
  if (type === "hr") return v <= 50 ? "#34d399" : v <= 60 ? "#fbbf24" : "#fb923c";
  return v >= 75 ? "#34d399" : v >= 50 ? "#fbbf24" : v >= 25 ? "#fb923c" : "#f87171";
}

function RecoverySection({ wellness }: { wellness: WellnessEntry[] }) {
  const latest = wellness[0] ?? null;

  if (!latest) {
    return (
      <div className={`${card} p-6`}>
        <h2 className="text-base font-semibold text-white mb-0.5">Recovery</h2>
        <p className="text-xs text-slate-500 mb-6">Garmin wellness data</p>
        <p className="text-slate-600 text-sm text-center py-6">
          No wellness data yet — Garmin sync runs daily after setup.
        </p>
      </div>
    );
  }

  const metrics = [
    { label: "HRV", value: latest.hrv, unit: "ms", fmt: (v: number) => `${v}`, colorType: "hrv" as const },
    { label: "Sleep", value: latest.sleep_hrs, unit: "hrs", fmt: (v: number) => `${v}h`, colorType: "sleep" as const },
    { label: "Resting HR", value: latest.resting_hr, unit: "bpm", fmt: (v: number) => `${v}`, colorType: "hr" as const },
    { label: "Body Battery", value: latest.readiness, unit: "/ 100", fmt: (v: number) => `${v}`, colorType: "battery" as const },
  ];

  return (
    <div className={`${card} p-6`}>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-white">Recovery</h2>
          <p className="text-xs text-slate-500">Garmin · {fmtDate(latest.date)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map(({ label, value, unit, fmt, colorType }) => {
          const color = value != null ? wellnessValueColor(colorType, value) : "#334155";
          return (
            <div key={label} className="rounded-xl bg-[#070e1c] border border-[#1a2d50]/40 p-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">{label}</p>
              <p className="text-3xl font-bold tabular-nums leading-none" style={{ color, textShadow: value != null ? `0 0 20px ${color}55` : undefined }}>
                {value != null ? fmt(value) : "—"}
              </p>
              <p className="text-xs text-slate-600 mt-1">{unit}</p>
            </div>
          );
        })}
      </div>
      {wellness.length > 1 && (
        <div className="mt-4 border-t border-[#1a2d50]/40 pt-4">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">Last 7 days</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {wellness.slice(0, 7).reverse().map((w) => {
              const hrvColor = w.hrv != null ? wellnessValueColor("hrv", w.hrv) : "#334155";
              const sleepColor = w.sleep_hrs != null ? wellnessValueColor("sleep", w.sleep_hrs) : "#334155";
              return (
                <div key={w.date} className="flex-shrink-0 text-center min-w-[48px]">
                  <p className="text-[10px] text-slate-600 mb-1">{fmtDate(w.date)}</p>
                  <p className="text-xs font-medium" style={{ color: hrvColor }}>
                    {w.hrv != null ? `${w.hrv}ms` : "—"}
                  </p>
                  <p className="text-xs" style={{ color: sleepColor }}>
                    {w.sleep_hrs != null ? `${w.sleep_hrs}h` : "—"}
                  </p>
                </div>
              );
            })}
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
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
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
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server error ${res.status}: ${errText}`);
      }
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = { role: "assistant", content: updated[assistantIdx].content + chunk };
          return updated;
        });
      }
      setMessages((prev) => {
        const updated = [...prev];
        if (!updated[assistantIdx]?.content) {
          updated[assistantIdx] = { role: "assistant", content: "No response received. Please try again." };
        }
        return updated;
      });
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className={`${card} flex flex-col h-[420px]`}>
      <div className="px-5 pt-5 pb-3 border-b border-[#1a2d50]/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px #34d399" }} />
          <h2 className="text-sm font-semibold text-white">Ask Your Coach</h2>
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5 ml-4">Powered by Gemini · uses your real training data</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="text-slate-600 text-xs text-center mt-10">
            Ask about your fitness, fatigue, training load, or what to do next.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[82%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed"
              style={
                m.role === "user"
                  ? { background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff" }
                  : { background: "#111e35", color: "#cbd5e1", border: "1px solid #1a2d50" }
              }
            >
              {m.content || <span className="text-slate-600 animate-pulse">▋</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 py-3 border-t border-[#1a2d50]/60 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Ask about your training…"
          disabled={streaming}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none disabled:opacity-40"
          style={{ background: "#070e1c", border: "1px solid #1a2d50" }}
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff" }}
        >
          {streaming ? "…" : "Send"}
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

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync");
      const json = await res.json();
      setSyncMsg(json.synced !== undefined ? `↑ ${json.synced} activities synced` : "Sync failed");
      await fetchData();
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#070b14" }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading training data…</p>
        </div>
      </div>
    );
  }

  const {
    fitness, weeklyVolume, current, ctlChange,
    thisWeek, lastWeek, trainingDays30, rolling28,
    recentActivities, wellness,
  } = data ?? {
    fitness: [], weeklyVolume: [],
    current: { date: "", ctl: 0, atl: 0, tsb: 0, tss: 0 },
    ctlChange: 0,
    thisWeek: { swim: 0, bike: 0, run: 0, total: 0 },
    lastWeek: { swim: 0, bike: 0, run: 0, total: 0 },
    trainingDays30: 0,
    rolling28: { swim: 0, bike: 0, run: 0, swimDist: 0, bikeDist: 0, runDist: 0 },
    recentActivities: [], wellness: [],
  };

  const volumeChart: VolumePoint[] = weeklyVolume.map((w) => ({
    ...w,
    swimH: parseFloat((w.swim / 60).toFixed(2)),
    bikeH: parseFloat((w.bike / 60).toFixed(2)),
    runH: parseFloat((w.run / 60).toFixed(2)),
  }));

  const tsbSign = current.tsb >= 0 ? "+" : "";
  const ctlSign = ctlChange >= 0 ? "+" : "";
  const tsbC = tsbColor(current.tsb);

  const axisStyle = { fill: "#334155", fontSize: 11 };

  return (
    <div className="min-h-screen text-white" style={{ background: "#070b14" }}>
      {/* Header */}
      <header
        className="px-6 py-4 flex items-center justify-between sticky top-0 z-10"
        style={{
          background: "rgba(7,11,20,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(26,45,80,0.6)",
        }}
      >
        <div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, #fff 0%, #64748b 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Ironman Training Dashboard
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-xs text-slate-500">{syncMsg}</span>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: syncing ? "#1a2d50" : "linear-gradient(135deg, #2563eb, #1d4ed8)",
              color: "#fff",
              boxShadow: syncing ? "none" : "0 0 16px rgba(37,99,235,0.35)",
            }}
          >
            {syncing ? "Syncing…" : "⚡ Sync Strava"}
          </button>
        </div>
      </header>

      <main className="px-6 py-6 space-y-5 max-w-7xl mx-auto">

        {/* Fitness metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile
            label="Fitness (CTL)"
            value={current.ctl.toFixed(1)}
            sub="42-day avg TSS"
            accentColor="#60a5fa"
            glowColor="rgba(96,165,250,0.3)"
            barClass="from-blue-600 to-blue-400"
            badge={ctlChange !== 0 ? { text: `${ctlSign}${ctlChange} this wk`, positive: ctlChange >= 0 } : null}
          />
          <MetricTile
            label="Fatigue (ATL)"
            value={current.atl.toFixed(1)}
            sub="7-day avg TSS"
            accentColor="#fb923c"
            glowColor="rgba(251,146,60,0.3)"
            barClass="from-orange-600 to-orange-400"
          />
          <MetricTile
            label="Form (TSB)"
            value={`${tsbSign}${current.tsb.toFixed(1)}`}
            sub={tsbLabel(current.tsb)}
            accentColor={tsbC}
            glowColor={`${tsbC}55`}
            barClass={current.tsb > 5 ? "from-emerald-600 to-emerald-400" : current.tsb >= -10 ? "from-yellow-600 to-yellow-400" : current.tsb >= -25 ? "from-orange-600 to-orange-400" : "from-red-600 to-red-400"}
          />
          <MetricTile
            label="Training Days"
            value={String(trainingDays30)}
            sub="last 30 days"
            accentColor="#94a3b8"
            glowColor="rgba(148,163,184,0.2)"
            barClass="from-slate-600 to-slate-400"
          />
        </div>

        {/* This week */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">This Week</h2>
            <span className="text-xs text-slate-600">
              {fmtHours(thisWeek.total)} total
              {lastWeek.total > 0 && (
                <span style={{ color: thisWeek.total >= lastWeek.total ? "#34d399" : "#f87171" }}>
                  {" "}({thisWeek.total >= lastWeek.total ? "+" : ""}{fmtHours(thisWeek.total - lastWeek.total)} vs last wk)
                </span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SportTile sport="swim" mins={thisWeek.swim} prevMins={lastWeek.swim} />
            <SportTile sport="bike" mins={thisWeek.bike} prevMins={lastWeek.bike} />
            <SportTile sport="run" mins={thisWeek.run} prevMins={lastWeek.run} />
          </div>
        </div>

        {/* 4-week rolling */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Last 4 Weeks</h2>
            <span className="text-xs text-slate-600">{fmtHours(rolling28.swim + rolling28.bike + rolling28.run)} total</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SportTile sport="swim" mins={rolling28.swim} dist={rolling28.swimDist} />
            <SportTile sport="bike" mins={rolling28.bike} dist={rolling28.bikeDist} />
            <SportTile sport="run" mins={rolling28.run} dist={rolling28.runDist} />
          </div>
        </div>

        {/* Fitness / Fatigue / Form chart */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-0.5">Fitness · Fatigue · Form</h2>
          <p className="text-xs text-slate-600 mb-5">Last 90 days</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={fitness} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisStyle} interval={13} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 16 }} formatter={(v) => <span style={{ color: "#475569" }}>{v}</span>} />
              <ReferenceLine y={0} stroke="#1a2d50" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="ctl" name="CTL (Fitness)" stroke="#60a5fa" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="atl" name="ATL (Fatigue)" stroke="#fb923c" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="tsb" name="TSB (Form)" stroke="#34d399" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Volume + activities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {volumeChart.length > 0 ? (
            <div className={`${card} p-5`}>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-0.5">Weekly Volume</h2>
              <p className="text-xs text-slate-600 mb-5">Hours per sport</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeChart} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="week" tickFormatter={fmtDate} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}h`} tick={axisStyle} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip weekMode />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} formatter={(v) => <span style={{ color: "#475569" }}>{v}</span>} />
                  <Bar dataKey="swimH" name="Swim" stackId="a" fill="#22d3ee" opacity={0.85} />
                  <Bar dataKey="bikeH" name="Bike" stackId="a" fill="#60a5fa" opacity={0.85} />
                  <Bar dataKey="runH" name="Run" stackId="a" fill="#c084fc" opacity={0.85} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={`${card} p-5 flex items-center justify-center`}>
              <p className="text-slate-600 text-sm">No volume data yet.</p>
            </div>
          )}

          <div className={`${card} p-5`}>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-0.5">Recent Activities</h2>
            <p className="text-xs text-slate-600 mb-4">Last 14 sessions</p>
            {recentActivities.length > 0 ? (
              <div className="overflow-y-auto max-h-56">
                {recentActivities.map((act) => <ActivityRow key={act.id} act={act} />)}
              </div>
            ) : (
              <p className="text-slate-600 text-sm text-center py-8">No activities. Sync Strava to load data.</p>
            )}
          </div>
        </div>

        {/* Recovery */}
        <RecoverySection wellness={wellness} />

        {/* Chat */}
        <ChatPanel />

        <div className="h-4" />
      </main>
    </div>
  );
}
