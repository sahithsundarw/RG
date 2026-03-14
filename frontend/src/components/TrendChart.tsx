import React from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { TrendPoint } from "../api/client";
import { format, parseISO } from "date-fns";

interface Props {
  data: TrendPoint[];
}

export const TrendChart: React.FC<Props> = ({ data }) => {
  const chartData = data.map((d) => ({
    date: format(parseISO(d.timestamp), "MMM d"),
    score: Math.round(d.overall_score),
    grade: d.grade,
  }));

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: 24,
      boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
    }}>
      <h3 style={{ color: "#0F172A", margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
        30-Day Health Trend
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#64748B", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "#FFFFFF", border: "1px solid #E2E8F0",
              color: "#0F172A", borderRadius: 8, fontSize: 13,
            }}
            formatter={(v: number, _: string, props: { payload: { grade: string } }) =>
              [`${v} (${props.payload.grade})`, "Health Score"]
            }
          />
          <ReferenceLine y={75} stroke="#86EFAC" strokeDasharray="4 2" label={{ value: "B", fill: "#16A34A", fontSize: 11 }} />
          <ReferenceLine y={60} stroke="#FDE047" strokeDasharray="4 2" label={{ value: "C", fill: "#CA8A04", fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#0F172A"
            strokeWidth={2}
            dot={{ fill: "#0F172A", r: 3 }}
            activeDot={{ r: 5, fill: "#0F172A" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
