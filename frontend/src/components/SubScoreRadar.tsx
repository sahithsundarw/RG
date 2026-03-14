import React from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";

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
  const data = [
    { subject: "Code Quality", value: subScores.code_quality },
    { subject: "Security", value: subScores.security },
    { subject: "Dependencies", value: subScores.dependencies },
    { subject: "Documentation", value: subScores.documentation },
    { subject: "Test Coverage", value: subScores.test_coverage },
  ];

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: 24,
      boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
    }}>
      <h3 style={{ color: "#0F172A", margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
        Sub-Score Breakdown
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data}>
          <PolarGrid stroke="#E2E8F0" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748B", fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#94A3B8", fontSize: 10 }} />
          <Radar
            name="Score"
            dataKey="value"
            stroke="#0F172A"
            fill="#0F172A"
            fillOpacity={0.06}
          />
          <Tooltip
            contentStyle={{
              background: "#FFFFFF", border: "1px solid #E2E8F0",
              color: "#0F172A", borderRadius: 8, fontSize: 13,
            }}
            formatter={(v: number) => [`${v.toFixed(1)}`, "Score"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};
