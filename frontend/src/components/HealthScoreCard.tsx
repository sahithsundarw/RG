import React from "react";

interface Props {
  score: number;
  grade: string;
  delta7d: number;
  velocity: "IMPROVING" | "STABLE" | "DEGRADING";
}

const velocityColor: Record<string, string> = {
  IMPROVING: "var(--success)",
  STABLE:    "var(--text-muted)",
  DEGRADING: "var(--danger)",
};

const VelocityArrow: React.FC<{ velocity: string }> = ({ velocity }) => {
  const color = velocityColor[velocity] ?? "var(--text-muted)";
  if (velocity === "IMPROVING") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
  if (velocity === "DEGRADING") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="14 7 19 12 14 17" />
    </svg>
  );
};

export const HealthScoreCard: React.FC<Props> = ({ score, grade, delta7d, velocity }) => {
  const vColor = velocityColor[velocity] ?? "var(--text-muted)";
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      padding: "28px 20px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
        <span style={{
          fontSize: 72,
          fontWeight: 800,
          color: "var(--text-primary)",
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}>
          {Math.round(score)}
        </span>
        <div style={{
          width: 1,
          height: 48,
          background: "var(--border)",
          margin: "0 14px",
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 40,
          fontWeight: 700,
          color: "var(--text-primary)",
          lineHeight: 1,
        }}>
          {grade}
        </span>
      </div>

      <div style={{ width: "100%", borderBottom: "1px solid var(--border)", margin: "4px 0" }} />

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        color: vColor,
        fontSize: 13,
        fontWeight: 600,
      }}>
        <VelocityArrow velocity={velocity} />
        {delta7d > 0 ? "+" : ""}{delta7d.toFixed(1)} pts
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        7-day delta
      </div>
    </div>
  );
};
