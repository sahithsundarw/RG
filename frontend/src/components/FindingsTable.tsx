import React, { useState } from "react";
import type { Finding } from "../api/client";
import { api } from "../api/client";

interface Props {
  findings: Finding[];
  onAction?: () => void;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#F59E0B",
  MEDIUM:   "#CA8A04",
  LOW:      "#10B981",
  INFO:     "var(--text-muted)",
};

const SEV_BG: Record<string, string> = {
  CRITICAL: "rgba(239,68,68,0.08)",
  HIGH:     "rgba(245,158,11,0.08)",
  MEDIUM:   "rgba(202,138,4,0.08)",
  LOW:      "rgba(16,185,129,0.08)",
  INFO:     "var(--bg-alt)",
};

const SEV_BORDER: Record<string, string> = {
  CRITICAL: "rgba(239,68,68,0.3)",
  HIGH:     "rgba(245,158,11,0.3)",
  MEDIUM:   "rgba(202,138,4,0.3)",
  LOW:      "rgba(16,185,129,0.3)",
  INFO:     "var(--border)",
};

const STATUS_CFG: Record<string, { color: string; label: string }> = {
  open:     { color: "var(--text-secondary)", label: "Open"     },
  approved: { color: "var(--success)",        label: "Approved" },
  rejected: { color: "var(--danger)",         label: "Rejected" },
  snoozed:  { color: "var(--text-muted)",     label: "Snoozed"  },
};

const Chevron: React.FC<{ up?: boolean }> = ({ up }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {up
      ? <polyline points="18 15 12 9 6 15" />
      : <polyline points="6 9 12 15 18 9" />
    }
  </svg>
);

export const FindingsTable: React.FC<Props> = ({ findings, onAction }) => {
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [loading,      setLoading]      = useState<string | null>(null);
  const [explaining,   setExplaining]   = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});

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

  const handleExplain = async (e: React.MouseEvent, findingId: string) => {
    e.stopPropagation();
    if (explanations[findingId]) return; // already loaded
    setExplaining(findingId);
    try {
      const res = await api.findings.explain(findingId);
      setExplanations((prev) => ({ ...prev, [findingId]: res.explanation }));
    } catch (err) {
      console.error("Explain failed:", err);
      setExplanations((prev) => ({ ...prev, [findingId]: "Could not generate explanation. Please try again." }));
    } finally {
      setExplaining(null);
    }
  };

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)",
    }}>
      {/* Table header */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <h3 style={{ color: "var(--text-primary)", margin: 0, fontSize: 13, fontWeight: 600 }}>
          Active Findings
        </h3>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {findings.length} result{findings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {findings.length === 0 && (
        <div style={{
          padding: "40px 20px",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}>
          No findings in this category.
        </div>
      )}

      {findings.map((f) => {
        const sc = STATUS_CFG[f.status] ?? STATUS_CFG.open;
        const isExpanded = expanded === f.id;
        return (
          <div key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
            {/* Row */}
            <div
              style={{
                padding: "11px 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onClick={() => setExpanded(isExpanded ? null : f.id)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {/* Severity badge */}
              <span style={{
                background: SEV_BG[f.severity] ?? "var(--bg-alt)",
                border: `1px solid ${SEV_BORDER[f.severity] ?? "var(--border)"}`,
                color: SEV_COLOR[f.severity] ?? "var(--text-muted)",
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                minWidth: 60,
                textAlign: "center",
                flexShrink: 0,
                letterSpacing: "0.04em",
              }}>
                {f.severity}
              </span>

              {/* Title */}
              <div style={{ flex: 1, color: "var(--text-primary)", fontSize: 13, overflow: "hidden" }}>
                <span>{f.title}</span>
                {f.file_path && (
                  <span style={{
                    color: "var(--text-muted)",
                    marginLeft: 8,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  }}>
                    {f.file_path}{f.line_start ? `:${f.line_start}` : ""}
                  </span>
                )}
              </div>

              {/* Status */}
              <span style={{
                color: sc.color,
                fontSize: 11,
                fontWeight: 500,
                flexShrink: 0,
              }}>
                {sc.label}
              </span>

              {/* Confidence + multi-agent badge */}
              <span style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                {f.multi_agent_agreement && (
                  <span title="Flagged by multiple agents" style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px",
                    background: "var(--accent-soft)", color: "var(--accent)",
                    border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
                    letterSpacing: "0.04em", textTransform: "uppercase",
                  }}>
                    Multi-agent
                  </span>
                )}
                <span style={{ color: "var(--text-muted)", fontSize: 11, minWidth: 32, textAlign: "right" }}>
                  {Math.round(f.confidence * 100)}%
                </span>
              </span>

              <span style={{ flexShrink: 0 }}>
                <Chevron up={isExpanded} />
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{
                padding: "0 20px 18px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg)",
                animation: "fadeIn 0.15s ease",
              }}>
                <p style={{
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  margin: "14px 0 10px",
                  lineHeight: 1.65,
                }}>
                  {f.description}
                </p>

                {f.evidence && (
                  <pre style={{
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    fontSize: 11,
                    overflowX: "auto",
                    margin: "8px 0",
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                    lineHeight: 1.6,
                  }}>
                    {f.evidence}
                  </pre>
                )}

                {f.suggested_fix && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 6,
                    }}>
                      Suggested Fix
                    </div>
                    <pre style={{
                      background: "var(--success-soft)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--success-border)",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-md)",
                      fontSize: 11,
                      overflowX: "auto",
                      fontFamily: "'JetBrains Mono','Fira Code',monospace",
                      lineHeight: 1.6,
                    }}>
                      {f.suggested_fix}
                    </pre>
                  </div>
                )}

                {/* Explain Risk */}
                <div style={{ marginTop: 12 }}>
                  {explanations[f.id] ? (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Risk Explanation</div>
                      {explanations[f.id]}
                    </div>
                  ) : (
                    <button
                      onClick={(e) => handleExplain(e, f.id)}
                      disabled={explaining === f.id}
                      style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", background: "transparent", cursor: explaining === f.id ? "not-allowed" : "pointer", opacity: explaining === f.id ? 0.6 : 1 }}
                    >
                      {explaining === f.id ? "Generating…" : "Explain Risk"}
                    </button>
                  )}
                </div>

                {/* HITL actions */}
                {f.status === "open" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "approve"); }}
                      disabled={loading === f.id + "approve"}
                      style={{
                        padding: "4px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: "1px solid var(--success-border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--success)",
                        background: "var(--success-soft)",
                        cursor: "pointer",
                        transition: "opacity 0.15s",
                        opacity: loading === f.id + "approve" ? 0.5 : 1,
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "reject"); }}
                      disabled={loading === f.id + "reject"}
                      style={{
                        padding: "4px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: "1px solid var(--danger-border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--danger)",
                        background: "var(--danger-soft)",
                        cursor: "pointer",
                        transition: "opacity 0.15s",
                        opacity: loading === f.id + "reject" ? 0.5 : 1,
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(f.id, "snooze"); }}
                      style={{
                        padding: "4px 12px",
                        fontSize: 12,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-muted)",
                        background: "transparent",
                        cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      Snooze 7d
                    </button>
                  </div>
                )}

                <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 12, fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
                  {f.id.substring(0, 8)} · {f.agent_source} · PR #{f.pr_number}
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
