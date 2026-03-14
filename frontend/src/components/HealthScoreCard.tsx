import React from "react";

interface Props {
  score: number;
  grade: string;
  delta7d: number;
  velocity: "IMPROVING" | "STABLE" | "DEGRADING";
}

const velocityColor: Record<string, string> = {
  IMPROVING: "#16A34A", STABLE: "#64748B", DEGRADING: "#DC2626",
};

const VelocityArrow: React.FC<{ velocity: string }> = ({ velocity }) => {
  const color = velocityColor[velocity] ?? "#64748B";
  if (velocity === "IMPROVING") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
  if (velocity === "DEGRADING") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="14 7 19 12 14 17" />
    </svg>
  );
};

export const HealthScoreCard: React.FC<Props> = ({ score, grade, delta7d, velocity }) => {
  const vColor = velocityColor[velocity] ?? "#64748B";
  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 16,
      padding: "28px 24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
      minWidth: 180,
      boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
    }}>
      {/* Score + Grade row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
        <span style={{ fontSize: 80, fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>
          {Math.round(score)}
        </span>
        <div style={{ width: 1, height: 52, background: "#E2E8F0", margin: "0 14px", flexShrink: 0 }} />
        <span style={{ fontSize: 44, fontWeight: 700, color: "#0F172A", lineHeight: 1 }}>
          {grade}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: "100%", borderBottom: "1px solid #E2E8F0", margin: "4px 0" }} />

      {/* Delta row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: vColor, fontSize: 14, fontWeight: 600 }}>
        <VelocityArrow velocity={velocity} />
        {delta7d > 0 ? "+" : ""}{delta7d.toFixed(1)} pts (7d)
      </div>

      <div style={{ color: "#64748B", fontSize: 12, letterSpacing: "0.02em" }}>
        Health Score
      </div>
    </div>
  );
};
