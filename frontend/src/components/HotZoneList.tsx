import React from "react";
import type { HotZone } from "../api/client";

interface Props {
  zones: HotZone[];
}

export const HotZoneList: React.FC<Props> = ({ zones }) => {
  const maxRisk = Math.max(...zones.map((z) => z.risk_score), 1);

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "20px 20px",
      boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2c-4 5-1 9-1 9s-2-1-2-3c0 4 2 7 5 8s5-3 5-6c0-3-2-4-2-4s1 2-1 4c0-5-4-8-4-8z" />
        </svg>
        <h3 style={{ color: "var(--text-primary)", margin: 0, fontSize: 13, fontWeight: 600 }}>
          Risk Hot Zones
        </h3>
      </div>

      {zones.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No hot zones detected.</div>
      )}

      {zones.map((zone, i) => {
        const pct = (zone.risk_score / maxRisk) * 100;
        const barColor =
          zone.critical_count > 0 ? "var(--danger)"
          : zone.high_count > 0 ? "var(--warning)"
          : "var(--border-strong)";

        return (
          <div key={i} style={{ marginBottom: i < zones.length - 1 ? 14 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "baseline" }}>
              <span style={{
                color: "var(--text-secondary)",
                fontSize: 11,
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "65%",
              }}>
                {zone.file_path}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                {zone.finding_count} findings
                {zone.critical_count > 0 && (
                  <span style={{ color: "var(--danger)", marginLeft: 4 }}>·{zone.critical_count}C</span>
                )}
                {zone.high_count > 0 && (
                  <span style={{ color: "var(--warning)", marginLeft: 4 }}>·{zone.high_count}H</span>
                )}
              </span>
            </div>
            <div style={{ background: "var(--bg-alt)", borderRadius: 2, height: 2, overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`,
                height: "100%",
                background: barColor,
                borderRadius: 2,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
