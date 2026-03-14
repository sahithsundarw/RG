import React from "react";
import type { HotZone } from "../api/client";

interface Props {
  zones: HotZone[];
}

export const HotZoneList: React.FC<Props> = ({ zones }) => {
  const maxRisk = Math.max(...zones.map((z) => z.risk_score), 1);

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: 24,
      boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2c-4 5-1 9-1 9s-2-1-2-3c0 4 2 7 5 8s5-3 5-6c0-3-2-4-2-4s1 2-1 4c0-5-4-8-4-8z" />
        </svg>
        <h3 style={{ color: "#0F172A", margin: 0, fontSize: 14, fontWeight: 600 }}>
          Risk Hot Zones
        </h3>
      </div>

      {zones.length === 0 && (
        <div style={{ color: "#64748B", fontSize: 13 }}>No hot zones detected.</div>
      )}

      {zones.map((zone, i) => {
        const pct = (zone.risk_score / maxRisk) * 100;
        const barColor =
          zone.critical_count > 0 ? "#0F172A"
          : zone.high_count > 0 ? "#64748B"
          : "#CBD5E1";

        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline" }}>
              <span style={{ color: "#0F172A", fontSize: 12, fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
                {zone.file_path}
              </span>
              <span style={{ color: "#64748B", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                {zone.finding_count} findings
                {zone.critical_count > 0 && ` · ${zone.critical_count}C`}
                {zone.high_count > 0 && ` · ${zone.high_count}H`}
              </span>
            </div>
            <div style={{ background: "#F1F5F9", borderRadius: 4, height: 4, overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`, height: "100%",
                background: barColor,
                borderRadius: 4,
                transition: "width 0.3s",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
