import React from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";
import { useTheme } from "../context/ThemeContext";

interface SubScores {
  code_quality: number;
  security: number;
  dependencies: number;
  documentation: number;
  test_coverage: number;
}

interface Props {
  subScores: SubScores;
}

export const SubScoreRadar: React.FC<Props> = ({ subScores }) => {
  const { isDark } = useTheme();
  const data = [
    { subject: "Code Quality",  value: subScores.code_quality },
    { subject: "Security",      value: subScores.security },
    { subject: "Dependencies",  value: subScores.dependencies },
    { subject: "Documentation", value: subScores.documentation },
    { subject: "Test Coverage", value: subScores.test_coverage },
  ];

  const gridColor     = isDark ? "#1E2D45" : "#E9E7F3";
  const axisColor     = isDark ? "#64748B" : "#9CA3AF";
  const strokeColor   = isDark ? "#8B5CF6" : "#7C3AED";
  const fillColor     = isDark ? "#8B5CF6" : "#7C3AED";
  const tooltipBg     = isDark ? "#131C2E" : "#FFFFFF";
  const tooltipBorder = isDark ? "#1E2D45" : "#E9E7F3";
  const tooltipText   = isDark ? "#F1F5F9" : "#0F172A";

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "20px 20px",
      boxShadow: "var(--shadow-sm)",
    }}>
      <h3 style={{ color: "var(--text-primary)", margin: "0 0 14px", fontSize: 13, fontWeight: 600 }}>
        Sub-Score Breakdown
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data}>
          <PolarGrid stroke={gridColor} />
          <PolarAngleAxis dataKey="subject" tick={{ fill: axisColor, fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 10 }} />
          <Radar
            name="Score"
            dataKey="value"
            stroke={strokeColor}
            fill={fillColor}
            fillOpacity={isDark ? 0.15 : 0.08}
            strokeWidth={1.5}
          />
          <Tooltip
            contentStyle={{
              background: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              color: tooltipText,
              borderRadius: 8,
              fontSize: 12,
              boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.08)",
            }}
            formatter={(v: number) => [`${v.toFixed(1)}`, "Score"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};
