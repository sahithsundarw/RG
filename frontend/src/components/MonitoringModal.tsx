import React, { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import type { MonitoringConfig } from "../api/client";
import { api, API_BASE_URL } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (repoId: string, repoUrl: string) => void;
}

type ModalPhase = "form" | "saving" | "success";

export const MonitoringModal: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const [url,          setUrl]          = useState("");
  const [secret,       setSecret]       = useState("");
  const [scanPath,     setScanPath]     = useState("");
  const [prEnabled,    setPrEnabled]    = useState(true);
  const [pushEnabled,  setPushEnabled]  = useState(true);
  const [mergeEnabled, setMergeEnabled] = useState(false);
  const [phase,        setPhase]        = useState<ModalPhase>("form");
  const [error,        setError]        = useState<string | null>(null);
  const [savedRepoId,  setSavedRepoId]  = useState<string | null>(null);
  const [copied,       setCopied]       = useState(false);
  const [urlFocused,   setUrlFocused]   = useState(false);
  const [secFocused,   setSecFocused]   = useState(false);
  const [pathFocused,  setPathFocused]  = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  const webhookEndpoint = `${API_BASE_URL || window.location.origin}/webhooks/github`;

  useEffect(() => {
    if (!open) {
      setSavedRepoId(null);
      setError(null);
      setCopied(false);
      setPhase("form");
      setUrl("");
      setSecret("");
      setScanPath("");
      return;
    }
    const timer = setTimeout(() => firstInputRef.current?.focus(), 50);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) { setError("Repository URL is required."); return; }
    setError(null);
    setPhase("saving");
    try {
      const config: MonitoringConfig = {
        clone_url:      trimmedUrl,
        webhook_secret: secret.trim(),
        scan_path:      scanPath.trim().replace(/^\/|\/$/g, ""), // strip leading/trailing slashes
        events: { pull_requests: prEnabled, pushes: pushEnabled, merges: mergeEnabled },
      };
      const repo = await api.monitoring.register(config);
      setSavedRepoId(repo.id);
      setPhase("success");
    } catch (e) {
      setError(String(e));
      setPhase("form");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookEndpoint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "9px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    border: `1px solid ${focused ? "var(--text-primary)" : "var(--border)"}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    background: "var(--bg)",
    color: "var(--text-primary)",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", padding: "28px 28px",
          width: "min(480px, 92vw)", boxShadow: "var(--shadow-lg)",
          maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box",
          animation: "fadeIn 0.2s ease",
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              {phase === "success" ? "Repository Connected" : "Connect Repository"}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
              {phase === "success"
                ? "Add the webhook URL to your GitHub repo settings"
                : "Configure webhook-based continuous monitoring"}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6,
              color: "var(--text-muted)", borderRadius: "var(--radius-sm)", display: "flex",
              alignItems: "center", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ══════════════ SUCCESS ══════════════ */}
        {phase === "success" && savedRepoId && (
          <div style={{ animation: "fadeIn 0.25s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 20,
              background: "var(--success-soft)", border: "1px solid var(--success-border)", borderRadius: "var(--radius-md)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 500 }}>Repository registered successfully</span>
            </div>

            {/* Step 1: copy webhook URL */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 8 }}>Step 1 — Copy your webhook URL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", padding: "8px 12px", background: "var(--bg)" }}>
                <code style={{ flex: 1, fontSize: 11, color: "var(--text-primary)", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {webhookEndpoint}
                </code>
                <button onClick={handleCopy}
                  style={{ flexShrink: 0, background: copied ? "var(--success-soft)" : "var(--surface)",
                    border: `1px solid ${copied ? "var(--success-border)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)", padding: "4px 10px", fontSize: 11, fontWeight: 600,
                    color: copied ? "var(--success)" : "var(--text-secondary)", cursor: "pointer" }}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Step 2: GitHub instructions */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 10 }}>Step 2 — Add webhook in GitHub</div>
              {[
                "Go to your repo Settings → Webhooks → Add webhook",
                "Paste the URL above into Payload URL",
                "Set Content type to application/json",
                "Enter the webhook secret you configured",
                "Choose: Individual events → Pull requests and Pushes",
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%",
                    background: "var(--accent-soft)", border: "1px solid var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>{step}</span>
                </div>
              ))}
            </div>

            <button onClick={() => { onSaved(savedRepoId, url.trim()); onClose(); }}
              style={{ width: "100%", padding: "10px 16px", background: "var(--accent)",
                color: "var(--accent-text)", border: "none", borderRadius: "var(--radius-md)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}>
              View Monitoring Dashboard
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
        )}

        {/* ══════════════ FORM / SAVING ══════════════ */}
        {(phase === "form" || phase === "saving") && (
          <>
            {/* URL */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Repository URL
              </label>
              <input ref={firstInputRef} value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="https://github.com/owner/repo"
                style={inputStyle(urlFocused)}
                onFocus={() => setUrlFocused(true)}
                onBlur={() => setUrlFocused(false)} />
            </div>

            {/* Webhook Secret */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Webhook Secret
              </label>
              <input value={secret} onChange={(e) => setSecret(e.target.value)}
                placeholder="Your GitHub webhook secret" type="password"
                style={inputStyle(secFocused)}
                onFocus={() => setSecFocused(true)}
                onBlur={() => setSecFocused(false)} />
            </div>

            {/* Scan path (optional) */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Scan subdirectory
                <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6 }}>— optional</span>
              </label>
              <input value={scanPath} onChange={(e) => setScanPath(e.target.value)}
                placeholder="e.g. backend  (leave blank to scan entire repo)"
                style={{ ...inputStyle(pathFocused), fontFamily: "'JetBrains Mono','Fira Code',monospace" }}
                onFocus={() => setPathFocused(true)}
                onBlur={() => setPathFocused(false)} />
            </div>

            {/* Event toggles */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Event Triggers
              </div>
              {[
                { label: "Pull Requests", desc: "Review on open or update",  value: prEnabled,    onChange: setPrEnabled },
                { label: "Pushes",        desc: "Analyze default branch",    value: pushEnabled,  onChange: setPushEnabled },
                { label: "Merges",        desc: "Validate before merge",     value: mergeEnabled, onChange: setMergeEnabled },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{desc}</div>
                  </div>
                  <ToggleSwitch checked={value} onChange={onChange} />
                </div>
              ))}
            </div>

            {error && (
              <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14, padding: "8px 12px",
                background: "var(--danger-soft)", border: "1px solid var(--danger-border)",
                borderRadius: "var(--radius-md)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={handleSave} disabled={phase === "saving"}
                style={{ flex: 1, padding: "10px 16px",
                  background: phase === "saving" ? "var(--border)" : "var(--accent)",
                  color: phase === "saving" ? "var(--text-muted)" : "var(--accent-text)",
                  border: "none", borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
                  cursor: phase === "saving" ? "not-allowed" : "pointer", transition: "background 0.15s" }}
                onMouseEnter={(e) => { if (phase !== "saving") e.currentTarget.style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { if (phase !== "saving") e.currentTarget.style.background = "var(--accent)"; }}>
                {phase === "saving" ? "Saving…" : "Save Configuration"}
              </button>
              <button onClick={onClose}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)",
                  fontSize: 13, cursor: "pointer", padding: "10px 8px",
                  textDecoration: "underline", textUnderlineOffset: 3 }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
