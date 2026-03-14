import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Repository } from "../api/client";
import { useTheme } from "../context/ThemeContext";

interface RepoHealth { score: number | null; grade: string | null; findings: number | null; }
interface Ping { repoId: string; eventType: string; score: number; grade: string; ts: number; }

const TRIGGER_LABELS: Record<string, string> = {
  pull_requests: "Pull Requests",
  pushes: "Pushes",
  merges: "Merges",
};

function gradeColor(g: string) {
  if (g === "A") return "var(--success)";
  if (g === "B") return "var(--info)";
  if (g === "C") return "var(--warning)";
  return "var(--danger)";
}

export const MonitoredRepos: React.FC = () => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const esRef = useRef<EventSource | null>(null);

  const [repos,   setRepos]   = useState<Repository[]>([]);
  const [health,  setHealth]  = useState<Record<string, RepoHealth>>({});
  const [pings,   setPings]   = useState<Record<string, Ping>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const list = await api.repositories.list();
      setRepos(list);
      const entries = await Promise.all(
        list.map(async (r) => {
          try {
            const h = await api.health.dashboard(r.id);
            const total = (Object.values(h.active_findings) as number[]).reduce((a, b) => a + b, 0);
            return [r.id, { score: h.overall_score, grade: h.grade, findings: total }] as [string, RepoHealth];
          } catch {
            return [r.id, { score: null, grade: null, findings: null }] as [string, RepoHealth];
          }
        })
      );
      setHealth(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const es = new EventSource(api.events.streamUrl());
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "webhook_processed" && ev.repo_id) {
          const ping: Ping = { repoId: ev.repo_id, eventType: ev.event_type, score: ev.health_score, grade: ev.grade, ts: Date.now() };
          setPings((prev) => ({ ...prev, [ev.repo_id]: ping }));
          setHealth((prev) => ({ ...prev, [ev.repo_id]: { score: ev.health_score, grade: ev.grade, findings: ev.total_findings } }));
          setTimeout(() => setPings((prev) => { const n = { ...prev }; delete n[ev.repo_id]; return n; }), 4000);
        }
      } catch { /* ignore parse errors */ }
    };
    return () => { es.close(); };
  }, []);

  const bshadow = isDark
    ? "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)"
    : "0 32px 80px rgba(124,58,237,0.18), 0 0 0 1px rgba(190,184,255,0.5)";

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--backdrop)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--backdrop)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "28px 24px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 980, background: "var(--bg)", borderRadius: 24, overflow: "clip", boxShadow: bshadow, minHeight: "calc(100vh - 56px)" }}>

        {/* Header */}
        <header style={{ position: "sticky", top: 0, zIndex: 10, borderBottom: "1px solid var(--border)", background: "var(--surface)", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => navigate("/")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              Back
            </button>
            <span style={{ width: 1, height: 16, background: "var(--border)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
              </svg>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Monitoring Dashboard</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {repos.length} repo{repos.length !== 1 ? "s" : ""} monitored
            </span>
            <button onClick={() => navigate("/")} style={{ padding: "5px 12px", background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: "var(--radius-md)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + Connect
            </button>
          </div>
        </header>

        <main style={{ padding: "32px", maxWidth: 900, margin: "0 auto" }}>
          {repos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 24px" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
                <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
              </svg>
              <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 20px" }}>No repositories connected yet.</p>
              <button onClick={() => navigate("/")} style={{ padding: "9px 20px", background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Connect a Repository
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {repos.map((repo) => {
                const h = health[repo.id];
                const ping = pings[repo.id];
                const triggers = repo.config?.trigger_events ?? { pull_requests: true, pushes: true, merges: false };
                const borderColor = ping ? "var(--accent)" : "var(--border)";
                const cardShadow = ping ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-sm)";
                return (
                  <div key={repo.id}
                    onClick={() => navigate("/repo/" + repo.id)}
                    style={{ background: "var(--surface)", border: "1px solid " + borderColor, borderRadius: "var(--radius-lg)", padding: "20px 24px", boxShadow: cardShadow, transition: "border-color 0.4s, box-shadow 0.4s", display: "flex", alignItems: "center", gap: 24, cursor: "pointer" }}
                  >
                    {/* Health score */}
                    <div style={{ flexShrink: 0, textAlign: "center", minWidth: 64 }}>
                      {h && h.score != null ? (
                        <>
                          <div style={{ fontSize: 36, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.03em" }}>{Math.round(h.score)}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: gradeColor(h.grade!), marginTop: 2 }}>{h.grade}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>No scan yet</div>
                      )}
                    </div>

                    <div style={{ width: 1, height: 48, background: "var(--border)", flexShrink: 0 }} />

                    {/* Repo info + triggers */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "monospace" }}>{repo.full_name}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 10, background: "var(--accent-soft)", border: "1px solid rgba(139,92,246,0.25)" }}>{repo.platform}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(Object.entries(triggers) as [string, boolean][]).filter(([, on]) => on).map(([k]) => (
                          <span key={k} style={{ fontSize: 10, fontWeight: 500, color: "var(--success)", padding: "2px 7px", borderRadius: 10, background: "var(--success-soft)", border: "1px solid var(--success-border)" }}>
                            {TRIGGER_LABELS[k] || k}
                          </span>
                        ))}
                        {(Object.entries(triggers) as [string, boolean][]).filter(([, on]) => !on).map(([k]) => (
                          <span key={k} style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", padding: "2px 7px", borderRadius: 10, border: "1px solid var(--border)" }}>
                            {(TRIGGER_LABELS[k] || k) + " off"}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Findings count + live ping */}
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      {h && h.findings != null && (
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                          {h.findings} finding{h.findings !== 1 ? "s" : ""}
                        </div>
                      )}
                      {ping ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--accent)", padding: "3px 8px", borderRadius: 20, background: "var(--accent-soft)", border: "1px solid rgba(139,92,246,0.3)", animation: "fadeIn 0.3s ease" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease infinite" }} />
                          Event received
                        </div>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
