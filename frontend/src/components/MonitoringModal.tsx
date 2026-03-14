import React, { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import type { MonitoringConfig } from "../api/client";
import { api } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#64748B",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export const MonitoringModal: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [prEnabled, setPrEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [mergeEnabled, setMergeEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        clone_url: url.trim(),
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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 16,
          padding: "32px 28px",
          width: "min(480px, 92vw)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>
            Connect Repository
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 1 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* URL */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Repository URL</label>
          <input
            ref={firstInputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "#0F172A")}
            onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
          />
        </div>

        {/* Secret */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Webhook Secret</label>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Your GitHub webhook secret"
            type="password"
            style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "#0F172A")}
            onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
          />
        </div>

        {/* Toggles */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Event Triggers
          </div>
          {[
            { label: "Pull Requests", value: prEnabled, onChange: setPrEnabled },
            { label: "Pushes", value: pushEnabled, onChange: setPushEnabled },
            { label: "Merges", value: mergeEnabled, onChange: setMergeEnabled },
          ].map(({ label, value, onChange }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 0", borderBottom: "1px solid #E2E8F0",
            }}>
              <span style={{ fontSize: 14, color: "#0F172A" }}>{label}</span>
              <ToggleSwitch checked={value} onChange={onChange} />
            </div>
          ))}
        </div>

        {error && (
          <div style={{ color: "#DC2626", fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: saving ? "#334155" : "#000000",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#64748B",
              fontSize: 14,
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
