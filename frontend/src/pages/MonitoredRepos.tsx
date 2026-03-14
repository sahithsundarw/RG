import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Repository } from "../api/client";
import { useTheme } from "../context/ThemeContext";

interface RepoHealth {
  score: number | null;
  grade: string | null;
  findings: number | null;
  hasScanData: boolean;   // false = repo registered but never scanned
}

type PingType = "processing" | "done" | "failed";

interface Ping {
  repoId: string;
  eventType: string;
  score: number | null;
  grade: string | null;
  ts: number;
  pingType: PingType;
}

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

  const [repos,    setRepos]    = useState<Repository[]>([]);
  const [health,   setHealth]   = useState<Record<string, RepoHealth>>({});
  const [pings,    setPings]    = useState<Record<string, Ping>>({});
  const [loading,  setLoading]  = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = async (e: React.MouseEvent, repoId: string) => {
    e.stopPropagation();
    setRemoving(repoId);
    try {
      await api.repositories.delete(repoId);
      setRepos((prev) => prev.filter((r) => r.id !== repoId));
    } catch (err) {
      console.error("Remove failed:", err);
    } finally {
      setRemoving(null);
    }
  };

  const fetchAll = async () => {
    try {
      const list = await api.repositories.list();
      setRepos(list);
      const entries = await Promise.all(
        list.map(async (r) => {
          try {
            const h = await api.health.dashboard(r.id);
            const total = (Object.values(h.active_findings) as number[]).reduce((a, b) => a + b, 0);
            return [r.id, {
              score: h.has_scan_data === false ? null : h.overall_score,
              grade: h.has_scan_data === false ? null : h.grade,
              findings: h.has_scan_data === false ? null : total,
              hasScanData: h.has_scan_data !== false,
            }] as [string, RepoHealth];
          } catch {
            return [r.id, { score: null, grade: null, findings: null, hasScanData: false }] as [string, RepoHealth];
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

        // Webhook received — scan has started (show activity immediately)
        if (ev.type === "webhook_received" && ev.repo_id) {
          const ping: Ping = {
            repoId: ev.repo_id,
            eventType: ev.event_type,
            score: null,
            grade: null,
            ts: Date.now(),
            pingType: "processing",
          };
          setPings((prev) => ({ ...prev, [ev.repo_id]: ping }));
          setTimeout(() => setPings((prev) => {
            const n = { ...prev };
            // Only clear if still showing the same ping (not replaced by a done ping)
            if (n[ev.repo_id]?.pingType === "processing" && n[ev.repo_id]?.ts === ping.ts) {
              delete n[ev.repo_id];
            }
            return n;
          }), 60_000);  // auto-clear after 60s if no done event arrives
        }

        // Scan complete
        if (ev.type === "webhook_processed" && ev.repo_id) {
          const ping: Ping = {
            repoId: ev.repo_id,
            eventType: ev.event_type,
            score: ev.health_score,
            grade: ev.grade,
            ts: Date.now(),
            pingType: "done",
          };
          setPings((prev) => ({ ...prev, [ev.repo_id]: ping }));
          setHealth((prev) => ({
            ...prev,
            [ev.repo_id]: {
              score: ev.health_score,
              grade: ev.grade,
              findings: ev.total_findings,
              hasScanData: true,
            },
          }));
          setTimeout(() => setPings((prev) => { const n = { ...prev }; delete n[ev.repo_id]; return n; }), 6000);
        }

        // Scan failed
        if (ev.type === "webhook_failed" && ev.repo_id) {
          const ping: Ping = {
            repoId: ev.repo_id,
            eventType: ev.event_type,
            score: null,
            grade: null,
            ts: Date.now(),
            pingType: "failed",
          };
          setPings((prev) => ({ ...prev, [ev.repo_id]: ping }));
          setTimeout(() => setPings((prev) => { const n = { ...prev }; delete n[ev.repo_id]; return n; }), 6000);
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
            <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13 }}>
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
                const scanPath = repo.config?.scan_path;
                const borderColor = ping ? "var(--accent)" : "var(--border)";
                const cardShadow = ping ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-sm)";

                // Determine the live ping badge appearance
                const pingLabel =
                  ping?.pingType === "processing" ? "Analyzing…"
                  : ping?.pingType === "done"       ? "Scan complete"
                  : ping?.pingType === "failed"     ? "Scan failed"
                  : null;
                const pingColor =
                  ping?.pingType === "failed" ? "var(--danger)"
                  : "var(--accent)";
                const pingBg =
                  ping?.pingType === "failed" ? "var(--danger-soft)"
                  : "var(--accent-soft)";
                const pingBorder =
                  ping?.pingType === "failed" ? "rgba(220,38,38,0.3)"
                  : "rgba(139,92,246,0.3)";

                return (
                  <div key={repo.id}
                    onClick={() => navigate("/repo/" + repo.id)}
                    style={{ background: "var(--surface)", border: "1px solid " + borderColor, borderRadius: "var(--radius-lg)", padding: "20px 24px", boxShadow: cardShadow, transition: "border-color 0.4s, box-shadow 0.4s", display: "flex", alignItems: "center", gap: 24, cursor: "pointer" }}
                  >
                    {/* Health score / waiting state */}
                    <div style={{ flexShrink: 0, textAlign: "center", minWidth: 64 }}>
                      {h && h.hasScanData && h.score != null ? (
                        <>
                          <div style={{ fontSize: 36, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.03em" }}>{Math.round(h.score)}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: gradeColor(h.grade!), marginTop: 2 }}>{h.grade}</div>
                        </>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                          </svg>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4, textAlign: "center" }}>
                            Waiting<br/>for events
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ width: 1, height: 48, background: "var(--border)", flexShrink: 0 }} />

                    {/* Repo info + triggers */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "monospace" }}>{repo.full_name}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 10, background: "var(--accent-soft)", border: "1px solid rgba(139,92,246,0.25)" }}>{repo.platform}</span>
                        {scanPath && (
                          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-secondary)", padding: "1px 6px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", fontFamily: "monospace" }}>{scanPath}/</span>
                        )}
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

                    {/* Findings count + live ping + remove */}
                    <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      {h && h.findings != null && (
                        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          {h.findings} finding{h.findings !== 1 ? "s" : ""}
                        </div>
                      )}
                      {ping && pingLabel ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: pingColor, padding: "3px 8px", borderRadius: 20, background: pingBg, border: `1px solid ${pingBorder}`, animation: "fadeIn 0.3s ease" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: pingColor, animation: ping.pingType === "processing" ? "pulse 1s ease infinite" : "none" }} />
                          {pingLabel}
                        </div>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      )}
                      <button
                        onClick={(e) => handleRemove(e, repo.id)}
                        disabled={removing === repo.id}
                        style={{ padding: "3px 10px", fontSize: 11, fontWeight: 500, border: "1px solid var(--danger-border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", background: "transparent", cursor: removing === repo.id ? "not-allowed" : "pointer", opacity: removing === repo.id ? 0.5 : 1 }}
                      >
                        {removing === repo.id ? "Removing…" : "Remove"}
                      </button>
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
