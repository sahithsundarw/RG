import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, SseDoneEvent, SseEvent } from "../api/client";
import { MonitoringModal } from "../components/MonitoringModal";
import { useTheme } from "../context/ThemeContext";

type AuditPhase = "idle" | "scanning" | "complete" | "error";

const PROGRESS_MAP: [string, number][] = [
  ["synthesis", 90], ["ai", 90],
  ["dep", 80],
  ["quality", 70],
  ["security", 55],
  ["static", 40],
  ["clone", 15],
];

const SCAN_STEPS = [
  { key: "clone",     label: "Cloning repository" },
  { key: "static",    label: "Static analysis" },
  { key: "security",  label: "Security scan" },
  { key: "quality",   label: "Quality assessment" },
  { key: "dep",       label: "Dependency audit" },
  { key: "ai",        label: "AI synthesis" },
  { key: "synthesis", label: "Generating report" },
];

function mapMessageToProgress(msg: string): number {
  const lower = msg.toLowerCase();
  for (const [key, val] of PROGRESS_MAP) {
    if (lower.includes(key)) return val;
  }
  return 0;
}

function getCompletedSteps(progress: number): number {
  if (progress >= 90) return 7;
  if (progress >= 80) return 6;
  if (progress >= 70) return 5;
  if (progress >= 55) return 4;
  if (progress >= 40) return 3;
  if (progress >= 15) return 2;
  if (progress >= 5)  return 1;
  return 0;
}

// ── Theme toggle ────────────────────────────────────────────────────────────

const ThemeToggle: React.FC = () => {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "6px 10px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 500,
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
    >
      {isDark ? (
        // Sun icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        // Moon icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {isDark ? "Light" : "Dark"}
    </button>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

export const RepositoryList: React.FC = () => {
  const navigate  = useNavigate();
  const esRef     = useRef<EventSource | null>(null);
  const { isDark } = useTheme();

  const [phase,        setPhase]        = useState<AuditPhase>("idle");
  const [repoUrl,      setRepoUrl]      = useState("");
  const [progress,     setProgress]     = useState(0);
  const [statusText,   setStatusText]   = useState("Initializing...");
  const [result,       setResult]       = useState<SseDoneEvent | null>(null);
  const [savedRepoId,  setSavedRepoId]  = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [urlFocused,   setUrlFocused]   = useState(false);

  const resetToIdle = () => {
    esRef.current?.close();
    esRef.current = null;
    setPhase("idle");
    setProgress(0);
    setStatusText("Initializing...");
    setResult(null);
    setSavedRepoId(null);
    setErrorMessage(null);
  };

  const handleRunAudit = async () => {
    if (!repoUrl.trim()) return;
    setPhase("scanning");
    setProgress(5);
    setStatusText("Initializing...");

    try {
      const { scan_id } = await api.scan.start(repoUrl.trim());
      const es = new EventSource(api.scan.streamUrl(scan_id));
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        let ev: SseEvent;
        try { ev = JSON.parse(e.data); } catch { return; }

        if (ev.type === "heartbeat") return;

        if (ev.type === "progress") {
          setStatusText(ev.message);
          const mapped = mapMessageToProgress(ev.message);
          if (mapped > 0) setProgress(mapped);
        }

        if (ev.type === "done") {
          setProgress(100);
          setResult(ev);
          es.close();
          esRef.current = null;
          api.scan.result(scan_id)
            .then((r) => { if (r.repo_id) setSavedRepoId(r.repo_id); })
            .catch(() => {})
            .finally(() => setPhase("complete"));
        }

        if (ev.type === "error") {
          setErrorMessage(ev.message);
          es.close();
          esRef.current = null;
          setPhase("error");
        }
      };

      es.onerror = () => {
        setErrorMessage("Connection to server lost. Please try again.");
        es.close();
        esRef.current = null;
        setPhase("error");
      };
    } catch (e) {
      setErrorMessage(String(e));
      setPhase("error");
    }
  };

  const completedSteps = getCompletedSteps(progress);

  const gradeColor = (grade: string) => {
    if (grade === "A") return "var(--success)";
    if (grade === "B") return "var(--info)";
    if (grade === "C") return "var(--warning)";
    return "var(--danger)";
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ── */}
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0 32px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        transition: "background 0.2s, border-color 0.2s",
      }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}
          onClick={resetToIdle}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            RepoGuardian
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
            Code Review Intelligence
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* ══════════════════════════ IDLE ══════════════════════════ */}
      {phase === "idle" && (
        <main style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "72px 24px 60px",
          animation: "fadeIn 0.3s ease",
        }}>
          {/* ── Brand + subtitle ── */}
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h1 style={{
              fontSize: 34,
              fontWeight: 800,
              color: "var(--text-primary)",
              margin: "0 0 10px",
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
            }}>
              RepoGuardian
            </h1>
            <p style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: 0,
              maxWidth: 400,
              marginInline: "auto",
              lineHeight: 1.6,
              letterSpacing: "0.01em",
            }}>
              One-shot security and quality audits, or continuous monitoring with automated PR reviews.
            </p>
          </div>

          {/* Two-panel grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* ── Panel A: Flash Audit ── */}
            <div style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "28px 24px",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              transition: "border-color 0.2s",
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--success)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    padding: "2px 8px",
                    borderRadius: 20,
                    background: "var(--success-soft)",
                    border: "1px solid var(--success-border)",
                  }}>
                    One-shot
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
                  Flash Audit
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
                  Security vulnerabilities, code quality, and dependency risks — delivered in minutes.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRunAudit(); }}
                  placeholder="https://github.com/owner/repo"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                    border: `1px solid ${urlFocused ? "var(--text-primary)" : "var(--border)"}`,
                    borderRadius: "var(--radius-md)",
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text-primary)",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={() => setUrlFocused(true)}
                  onBlur={() => setUrlFocused(false)}
                />
                <button
                  onClick={handleRunAudit}
                  disabled={!repoUrl.trim()}
                  style={{
                    width: "100%",
                    padding: "9px 16px",
                    background: repoUrl.trim() ? "var(--accent)" : "var(--border)",
                    color: repoUrl.trim() ? "var(--accent-text)" : "var(--text-muted)",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: repoUrl.trim() ? "pointer" : "not-allowed",
                    letterSpacing: "0.01em",
                    transition: "background 0.15s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) => { if (repoUrl.trim()) e.currentTarget.style.background = "var(--accent-hover)"; }}
                  onMouseLeave={(e) => { if (repoUrl.trim()) e.currentTarget.style.background = "var(--accent)"; }}
                >
                  Run Flash Audit
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Panel B: Continuous Monitoring ── */}
            <div style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "28px 24px",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              transition: "border-color 0.2s",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--accent)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    padding: "2px 8px",
                    borderRadius: 20,
                    background: "var(--accent-soft)",
                    border: "1px solid rgba(139,92,246,0.25)",
                  }}>
                    Automated
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
                  </svg>
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
                  Continuous Monitoring
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 18px", lineHeight: 1.55 }}>
                  Connect via webhook to automatically review every PR, push, and merge event.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {[
                    "PR review on open / update",
                    "Push analysis on default branch",
                    "Merge validation and scoring",
                  ].map((feat) => (
                    <div key={feat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setModalOpen(true)}
                style={{
                  width: "100%",
                  padding: "9px 16px",
                  background: "transparent",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-hover)";
                  e.currentTarget.style.borderColor = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Connect Repository
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ══════════════════════════ SCANNING ══════════════════════════ */}
      {phase === "scanning" && (
        <main style={{
          maxWidth: 580,
          margin: "0 auto",
          padding: "64px 24px 60px",
          animation: "fadeIn 0.3s ease",
        }}>
          {/* Repo label */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 6,
            }}>
              Analyzing
            </div>
            <div style={{
              fontSize: 12,
              color: "var(--text-primary)",
              fontFamily: "'JetBrains Mono','Fira Code',monospace",
              wordBreak: "break-all",
            }}>
              {repoUrl}
            </div>
          </div>

          {/* 2px progress bar */}
          <div style={{ height: 2, background: "var(--border)", borderRadius: 2, overflow: "hidden", marginBottom: 36 }}>
            <div style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
              borderRadius: 2,
              transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            }} />
          </div>

          {/* Step list */}
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 40 }}>
            {SCAN_STEPS.map((step, i) => {
              const isDone   = i < completedSteps;
              const isActive = i === completedSteps;
              return (
                <div
                  key={step.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 0",
                    borderBottom: i < SCAN_STEPS.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  {/* Step indicator */}
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: isDone ? "var(--success-soft)" : isActive ? "var(--accent-soft)" : "transparent",
                    border: `1px solid ${isDone ? "var(--success-border)" : isActive ? "var(--accent)" : "var(--border)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 0.3s, border-color 0.3s",
                  }}>
                    {isDone ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ animation: "checkIn 0.2s ease" }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isActive ? (
                      <div style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        animation: "pulse 1.2s ease infinite",
                      }} />
                    ) : null}
                  </div>

                  <span style={{
                    fontSize: 13,
                    color: isDone ? "var(--text-muted)" : isActive ? "var(--text-primary)" : "var(--text-muted)",
                    fontWeight: isActive ? 500 : 400,
                    transition: "color 0.3s",
                    flex: 1,
                  }}>
                    {step.label}
                  </span>

                  {isActive && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, maxWidth: 180, textAlign: "right" }}>
                      {statusText}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Skeleton result preview */}
          <div style={{ opacity: 0.45 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
            }}>
              Preparing results
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{
                flex: "0 0 140px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "20px 18px",
              }}>
                <div className="skeleton" style={{ height: 44, width: 72, marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 10, width: "70%" }} />
              </div>
              <div style={{
                flex: 1,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "20px 18px",
              }}>
                <div className="skeleton" style={{ height: 10, width: "45%", marginBottom: 14 }} />
                <div className="skeleton" style={{ height: 8, width: "100%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 8, width: "75%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 8, width: "55%" }} />
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ══════════════════════════ COMPLETE ══════════════════════════ */}
      {phase === "complete" && result && (
        <main style={{
          maxWidth: 580,
          margin: "0 auto",
          padding: "64px 24px 60px",
          animation: "fadeIn 0.4s ease",
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--success)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 24,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Audit Complete
          </div>

          {/* Score card */}
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "32px 28px",
            marginBottom: 14,
            boxShadow: "var(--shadow-sm)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20 }}>
              <span style={{
                fontSize: 76,
                fontWeight: 800,
                color: "var(--text-primary)",
                lineHeight: 1,
                letterSpacing: "-0.04em",
              }}>
                {result.health_score}
              </span>
              <div style={{ width: 1, height: 50, background: "var(--border)", margin: "0 20px", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Grade
                </div>
                <span style={{ fontSize: 42, fontWeight: 700, color: gradeColor(result.grade), lineHeight: 1 }}>
                  {result.grade}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 28 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
                  {result.total_findings}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  finding{result.total_findings !== 1 ? "s" : ""} detected
                </div>
              </div>
            </div>

            {result.message && (
              <p style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                margin: "18px 0 0",
                lineHeight: 1.6,
                borderTop: "1px solid var(--border)",
                paddingTop: 16,
              }}>
                {result.message}
              </p>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {savedRepoId ? (
              <button
                onClick={() => navigate(`/repo/${savedRepoId}`)}
                style={{
                  padding: "10px 16px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
              >
                View Full Report
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 0", lineHeight: 1.5 }}>
                Report not linked — register under Continuous Monitoring to track history.
              </div>
            )}
            <button
              onClick={resetToIdle}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 13,
                cursor: "pointer",
                padding: "6px 0",
                textAlign: "left",
              }}
            >
              ← New audit
            </button>
          </div>
        </main>
      )}

      {/* ══════════════════════════ ERROR ══════════════════════════ */}
      {phase === "error" && (
        <main style={{
          maxWidth: 580,
          margin: "0 auto",
          padding: "64px 24px 60px",
          animation: "fadeIn 0.3s ease",
        }}>
          <div style={{
            background: "var(--danger-soft)",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-lg)",
            padding: "18px 20px",
            marginBottom: 16,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ color: "var(--danger)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{errorMessage}</p>
          </div>
          <button
            onClick={resetToIdle}
            style={{
              padding: "9px 20px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
          >
            Try Again
          </button>
        </main>
      )}

      <MonitoringModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => setModalOpen(false)}
      />
    </div>
  );
};
