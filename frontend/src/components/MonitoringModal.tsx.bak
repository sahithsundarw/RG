import React, { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import type { MonitoringConfig } from "../api/client";
import { api } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const MonitoringModal: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const [url,          setUrl]          = useState("");
  const [secret,       setSecret]       = useState("");
  const [prEnabled,    setPrEnabled]    = useState(true);
  const [pushEnabled,  setPushEnabled]  = useState(true);
  const [mergeEnabled, setMergeEnabled] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [urlFocused,   setUrlFocused]   = useState(false);
  const [secFocused,   setSecFocused]   = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => firstInputRef.current?.focus(), 50);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    if (!url.trim()) { setError("Repository URL is required."); return; }
    setError(null);
    setSaving(true);
    try {
      const config: MonitoringConfig = {
        clone_url:      url.trim(),
        webhook_secret: secret.trim(),
        events: { pull_requests: prEnabled, pushes: pushEnabled, merges: mergeEnabled },
      };
      await api.monitoring.register(config);
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
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
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "28px 28px",
          width: "min(480px, 92vw)",
          boxShadow: "var(--shadow-lg)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxSizing: "border-box",
          animation: "fadeIn 0.2s ease",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              Connect Repository
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
              Configure webhook-based continuous monitoring
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 6,
              color: "var(--text-muted)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Repository URL
          </label>
          <input
            ref={firstInputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={inputStyle(urlFocused)}
            onFocus={() => setUrlFocused(true)}
            onBlur={() => setUrlFocused(false)}
          />
        </div>

        {/* Secret */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Webhook Secret
          </label>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Your GitHub webhook secret"
            type="password"
            style={inputStyle(secFocused)}
            onFocus={() => setSecFocused(true)}
            onBlur={() => setSecFocused(false)}
          />
        </div>

        {/* Event toggles */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Event Triggers
          </div>
          {[
            { label: "Pull Requests",  desc: "Review on open or update",   value: prEnabled,    onChange: setPrEnabled },
            { label: "Pushes",         desc: "Analyze default branch",      value: pushEnabled,  onChange: setPushEnabled },
            { label: "Merges",         desc: "Validate before merge",       value: mergeEnabled, onChange: setMergeEnabled },
          ].map(({ label, desc, value, onChange }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "11px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{desc}</div>
              </div>
              <ToggleSwitch checked={value} onChange={onChange} />
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            color: "var(--danger)",
            fontSize: 12,
            marginBottom: 14,
            padding: "8px 12px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-md)",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: saving ? "var(--border)" : "var(--accent)",
              color: saving ? "var(--text-muted)" : "var(--accent-text)",
              border: "none",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = "var(--accent)"; }}
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
              padding: "10px 8px",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
