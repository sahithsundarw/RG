import React, { useState } from "react";
import type { Finding } from "../api/client";
import { api } from "../api/client";

interface Props {
  findings: Finding[];
  onAction?: () => void;
}

const severityText: Record<string, string> = {
  CRITICAL: "#DC2626", HIGH: "#EA580C",
  MEDIUM: "#CA8A04", LOW: "#16A34A", INFO: "#64748B",
};

const severityBorder: Record<string, string> = {
  CRITICAL: "#FCA5A5", HIGH: "#FDBA74",
  MEDIUM: "#FDE047", LOW: "#86EFAC", INFO: "#E2E8F0",
};

const statusConfig: Record<string, { color: string; border: string; label: string }> = {
  open:     { color: "#0F172A",  border: "#CBD5E1", label: "Open" },
  approved: { color: "#16A34A", border: "#86EFAC", label: "Approved" },
  rejected: { color: "#DC2626", border: "#FCA5A5", label: "Rejected" },
  snoozed:  { color: "#94A3B8", border: "#E2E8F0", label: "Snoozed" },
};

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export const FindingsTable: React.FC<Props> = ({ findings, onAction }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (findingId: string, action: string) => {
    setLoading(findingId + action);
    try {
      await api.hitl.action(findingId, action);
      onAction?.();
    } catch (e) {
      console.error("HITL action failed:", e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
    }}>
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid #E2E8F0",
        background: "#F9FAFB",
      }}>
        <h3 style={{ color: "#0F172A", margin: 0, fontSize: 14, fontWeight: 600 }}>
          Active Findings ({findings.length})
        </h3>
      </div>

      {findings.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", color: "#64748B", fontSize: 14 }}>
          No active findings
        </div>
      )}

      {findings.map((f) => {
        const sc = statusConfig[f.status] ?? statusConfig.open;
        return (
          <div key={f.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
            {/* Row */}
            <div
              style={{
                padding: "12px 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
              }}
              onClick={() => setExpanded(expanded === f.id ? null : f.id)}
            >
              {/* Severity badge */}
              <span style={{
                border: `1px solid ${severityBorder[f.severity] ?? "#E2E8F0"}`,
                color: severityText[f.severity] ?? "#64748B",
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                minWidth: 64,
                textAlign: "center",
                background: "transparent",
                flexShrink: 0,
              }}>
                {f.severity}
              </span>

              {/* Title */}
              <div style={{ flex: 1, color: "#0F172A", fontSize: 14 }}>
                {f.title}
                {f.file_path && (
                  <span style={{
                    color: "#64748B", marginLeft: 8, fontSize: 12,
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  }}>
                    {f.file_path}{f.line_start ? `:${f.line_start}` : ""}
                  </span>
                )}
              </div>

              {/* Status */}
              <span style={{
                border: `1px solid ${sc.border}`,
                color: sc.color,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                background: "transparent",
                flexShrink: 0,
              }}>
                {sc.label}
              </span>

              {/* Confidence */}
              <span style={{ color: "#64748B", fontSize: 12, minWidth: 40, textAlign: "right", flexShrink: 0 }}>
                {Math.round(f.confidence * 100)}%
              </span>

              <span style={{ flexShrink: 0 }}>
                {expanded === f.id ? <ChevronUp /> : <ChevronDown />}
              </span>
            </div>

            {/* Expanded details */}
            {expanded === f.id && (
              <div style={{
                padding: "0 20px 16px",
                borderTop: "1px solid #E2E8F0",
                background: "#F9FAFB",
              }}>
                <p style={{ color: "#64748B", fontSize: 14, margin: "12px 0 8px", lineHeight: 1.6 }}>
                  {f.description}
                </p>

                {f.evidence && (
                  <pre style={{
                    background: "#F1F5F9", color: "#0F172A",
                    border: "1px solid #E2E8F0",
                    padding: 12, borderRadius: 6,
                    fontSize: 12, overflowX: "auto",
                    margin: "8px 0",
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  }}>
                    {f.evidence}
                  </pre>
                )}

                {f.suggested_fix && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "#0F172A", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Suggested Fix
                    </div>
                    <pre style={{
                      background: "#F1F5F9", color: "#0F172A",
                      border: "1px solid #E2E8F0",
                      padding: 12, borderRadius: 6,
                      fontSize: 12, overflowX: "auto",
                      fontFamily: "'JetBrains Mono','Fira Code',monospace",
                    }}>
                      {f.suggested_fix}
                    </pre>
                  </div>
                )}

                {/* HITL Actions */}
                {f.status === "open" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "approve"); }}
                      disabled={loading === f.id + "approve"}
                      style={{
                        padding: "5px 14px", fontSize: 12, fontWeight: 600,
                        border: "1px solid #86EFAC", borderRadius: 6,
                        color: "#16A34A", background: "transparent", cursor: "pointer",
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "reject"); }}
                      disabled={loading === f.id + "reject"}
                      style={{
                        padding: "5px 14px", fontSize: 12, fontWeight: 600,
                        border: "1px solid #FCA5A5", borderRadius: 6,
                        color: "#DC2626", background: "transparent", cursor: "pointer",
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "snooze"); }}
                      style={{
                        padding: "5px 14px", fontSize: 12,
                        border: "1px solid #E2E8F0", borderRadius: 6,
                        color: "#64748B", background: "transparent", cursor: "pointer",
                      }}
                    >
                      Snooze 7d
                    </button>
                  </div>
                )}

                <div style={{ color: "#94A3B8", fontSize: 11, marginTop: 10 }}>
                  ID: {f.id.substring(0, 8)} · Agent: {f.agent_source} · PR #{f.pr_number}
                  {f.cwe_id && ` · ${f.cwe_id}`}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
