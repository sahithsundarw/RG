import React from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { TrendPoint } from "../api/client";
import { format, parseISO } from "date-fns";
import { useTheme } from "../context/ThemeContext";

interface Props {
  data: TrendPoint[];
}

export const TrendChart: React.FC<Props> = ({ data }) => {
  const { isDark } = useTheme();

  const chartData = data.map((d) => ({
    date:  format(parseISO(d.timestamp), "MMM d"),
    score: Math.round(d.overall_score),
    grade: d.grade,
  }));

  const gridColor     = isDark ? "#1E2D45" : "#E9E7F3";
  const axisColor     = isDark ? "#64748B" : "#9CA3AF";
  const lineColor     = isDark ? "#8B5CF6" : "#7C3AED";
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
        30-Day Health Trend
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              color: tooltipText,
              borderRadius: 8,
              fontSize: 12,
              boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.08)",
            }}
            formatter={(v: number, _: string, props: { payload: { grade: string } }) =>
              [`${v} (${props.payload.grade})`, "Health Score"]
            }
          />
          <ReferenceLine
            y={75}
            stroke={isDark ? "rgba(139,92,246,0.35)" : "rgba(124,58,237,0.25)"}
            strokeDasharray="4 2"
            label={{ value: "B", fill: isDark ? "#8B5CF6" : "#7C3AED", fontSize: 10 }}
          />
          <ReferenceLine
            y={60}
            stroke={isDark ? "rgba(236,72,153,0.35)" : "rgba(236,72,153,0.3)"}
            strokeDasharray="4 2"
            label={{ value: "C", fill: isDark ? "#EC4899" : "#DB2777", fontSize: 10 }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke={lineColor}
            strokeWidth={1.5}
            dot={{ fill: lineColor, r: 2.5 }}
            activeDot={{ r: 4, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
