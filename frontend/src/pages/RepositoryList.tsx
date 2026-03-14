import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, SseDoneEvent, SseEvent } from "../api/client";
import { MonitoringModal } from "../components/MonitoringModal";

type AuditPhase = "idle" | "scanning" | "complete" | "error";

const PROGRESS_MAP: [string, number][] = [
  ["synthesis", 90], ["ai", 90],
  ["dep", 80],
  ["quality", 70],
  ["security", 55],
  ["static", 40],
  ["clone", 15],
];

function mapMessageToProgress(msg: string): number {
  const lower = msg.toLowerCase();
  for (const [key, val] of PROGRESS_MAP) {
    if (lower.includes(key)) return val;
  }
  return 0;
}

async function findOrRegisterRepo(cloneUrl: string): Promise<string | null> {
  const m = cloneUrl.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
  if (!m) return null;
  const fullName = `${m[1]}/${m[2]}`;
  try {
    const repo = await api.monitoring.register({
      clone_url: cloneUrl,
      webhook_secret: "",
      events: { pull_requests: false, pushes: false, merges: false },
    });
    return repo.id;
  } catch {
    try {
      const repos = await api.repositories.list();
      return repos.find((r) => r.full_name === fullName)?.id ?? null;
    } catch {
      return null;
    }
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  outline: "none",
  background: "#FFFFFF",
  color: "#0F172A",
  boxSizing: "border-box",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  background: "#000000",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.01em",
};

const outlineBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  background: "transparent",
  color: "#0F172A",
  border: "1px solid #0F172A",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export const RepositoryList: React.FC = () => {
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<AuditPhase>("idle");
  const [repoUrl, setRepoUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Starting audit...");
  const [result, setResult] = useState<SseDoneEvent | null>(null);
  const [savedRepoId, setSavedRepoId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [urlFocused, setUrlFocused] = useState(false);

  const resetToIdle = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress(0);
    setStatusText("Starting audit...");
    setResult(null);
    setSavedRepoId(null);
    setErrorMessage(null);
  };

  const handleRunAudit = async () => {
    if (!repoUrl.trim()) return;
    setPhase("scanning");
    setProgress(5);
    setStatusText("Initializing audit...");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Step 1: Start scan
      const { scan_id } = await api.scan.start(repoUrl.trim());

      // Step 2: Stream progress via fetch (more reliable than EventSource through Vite proxy)
      const response = await fetch(`/api/scan/${scan_id}/stream`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Stream failed: HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body from stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const text = line.slice(6).trim();
          if (!text) continue;

          let ev: SseEvent;
          try { ev = JSON.parse(text); } catch { continue; }

          if (ev.type === "heartbeat") continue;

          if (ev.type === "progress") {
            setStatusText(ev.message);
            const mapped = mapMessageToProgress(ev.message);
            if (mapped > 0) setProgress(mapped);
          }

          if (ev.type === "done") {
            setProgress(100);
            setResult(ev);
            // Register/find repo to get dashboard ID
            const id = await findOrRegisterRepo(repoUrl.trim()).catch(() => null);
            if (id) setSavedRepoId(id);
            setPhase("complete");
            return;
          }

          if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      }

      // Stream ended without a done/error event
      throw new Error("Scan stream ended unexpectedly. Check if the backend is running.");

    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return; // user cancelled
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFB" }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #E2E8F0",
        background: "#FFFFFF",
        padding: "0 40px",
        height: 56,
        display: "flex",
        alignItems: "center",
      }}>
        <span
          style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", cursor: "pointer" }}
          onClick={resetToIdle}
        >
          RepoGuardian
        </span>
      </div>

      {/* ── IDLE ── */}
      {phase === "idle" && (
        <div style={{ maxWidth: 840, margin: "80px auto", padding: "0 24px" }}>
          <div style={{ marginBottom: 40, textAlign: "center" }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0F172A", margin: "0 0 8px" }}>
              Code Intelligence Platform
            </h1>
            <p style={{ color: "#64748B", fontSize: 15, margin: 0 }}>
              Audit any repository instantly or set up continuous monitoring with webhooks.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Panel A */}
            <div style={{
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12,
              padding: "28px 24px", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Option A
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", margin: "0 0 4px" }}>
                  Audit Public Repository
                </h2>
                <p style={{ color: "#64748B", fontSize: 13, margin: 0 }}>
                  Instant security and quality scan with AI-generated report.
                </p>
              </div>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRunAudit(); }}
                placeholder="https://github.com/owner/repo"
                style={{ ...inputStyle, borderColor: urlFocused ? "#0F172A" : "#E2E8F0" }}
                onFocus={() => setUrlFocused(true)}
                onBlur={() => setUrlFocused(false)}
              />
              <button
                onClick={handleRunAudit}
                disabled={!repoUrl.trim()}
                style={{ ...primaryBtn, opacity: repoUrl.trim() ? 1 : 0.5, cursor: repoUrl.trim() ? "pointer" : "not-allowed" }}
                onMouseEnter={(e) => { if (repoUrl.trim()) e.currentTarget.style.background = "#1a1a1a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#000000"; }}
              >
                Run Flash Audit
              </button>
            </div>

            {/* Panel B */}
            <div style={{
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12,
              padding: "28px 24px", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Option B
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", margin: "0 0 4px" }}>
                  Continuous Monitoring
                </h2>
                <p style={{ color: "#64748B", fontSize: 13, margin: 0 }}>
                  Connect via webhook to automatically review every PR, push, and merge.
                </p>
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setModalOpen(true)}
                style={outlineBtn}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Connect Repository
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SCANNING ── */}
      {phase === "scanning" && (
        <div style={{
          maxWidth: 560, margin: "100px auto", padding: "0 24px",
          display: "flex", flexDirection: "column", gap: 20,
        }}>
          <div>
            <p style={{ color: "#64748B", fontSize: 13, margin: "0 0 4px" }}>Auditing</p>
            <p style={{ color: "#0F172A", fontSize: 14, fontWeight: 600, margin: 0, wordBreak: "break-all" }}>
              {repoUrl}
            </p>
          </div>
          <div style={{ height: 2, background: "#E2E8F0", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${progress}%`,
              background: "#0F172A", borderRadius: 2,
              transition: "width 0.6s ease",
            }} />
          </div>
          <p style={{ color: "#0F172A", fontSize: 14, margin: 0 }}>{statusText}</p>
          <button
            onClick={resetToIdle}
            style={{ background: "none", border: "none", color: "#94A3B8", fontSize: 13, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── COMPLETE ── */}
      {phase === "complete" && result && (
        <div style={{
          maxWidth: 560, margin: "80px auto", padding: "0 24px",
          animation: "fadeIn 0.3s ease",
          display: "flex", flexDirection: "column", gap: 24,
        }}>
          <div>
            <p style={{ color: "#64748B", fontSize: 12, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              Audit Complete
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
              <span style={{ fontSize: 72, fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>
                {result.health_score}
              </span>
              <div style={{ width: 1, height: 52, background: "#E2E8F0", margin: "0 16px", flexShrink: 0 }} />
              <span style={{ fontSize: 48, fontWeight: 700, color: "#0F172A", lineHeight: 1 }}>
                {result.grade}
              </span>
            </div>
            <p style={{ color: "#64748B", fontSize: 14, margin: "12px 0 0" }}>
              {result.total_findings} finding{result.total_findings !== 1 ? "s" : ""} detected
            </p>
            {result.message && (
              <p style={{ color: "#64748B", fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>
                {result.message}
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {savedRepoId ? (
              <button
                onClick={() => navigate(`/repo/${savedRepoId}`)}
                style={primaryBtn}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#000000")}
              >
                View Full Report
              </button>
            ) : (
              <p style={{ color: "#64748B", fontSize: 13, margin: 0 }}>
                Audit complete — could not link to a dashboard repo. Try connecting via Option B.
              </p>
            )}
            <button
              onClick={resetToIdle}
              style={{
                background: "transparent", border: "none", color: "#64748B",
                fontSize: 14, cursor: "pointer", padding: "8px 0",
                textDecoration: "underline", textUnderlineOffset: 3, textAlign: "left",
              }}
            >
              Start new audit
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {phase === "error" && (
        <div style={{
          maxWidth: 560, margin: "100px auto", padding: "0 24px",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ color: "#DC2626", fontSize: 14, margin: 0, lineHeight: 1.6 }}>{errorMessage}</p>
          </div>
          <button
            onClick={resetToIdle}
            style={{ ...primaryBtn, width: "auto", padding: "10px 24px" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#000000")}
          >
            Try Again
          </button>
        </div>
      )}

      <MonitoringModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(repoId) => {
          setModalOpen(false);
          if (repoId) navigate(`/repo/${repoId}`);
        }}
      />
    </div>
  );
};
