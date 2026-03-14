import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, HealthDashboard, Finding } from "../api/client";
import { HealthScoreCard } from "../components/HealthScoreCard";
import { SubScoreRadar } from "../components/SubScoreRadar";
import { FindingsTable } from "../components/FindingsTable";
import { TrendChart } from "../components/TrendChart";
import { HotZoneList } from "../components/HotZoneList";

const severityTextColor: Record<string, string> = {
  CRITICAL: "#DC2626", HIGH: "#EA580C",
  MEDIUM: "#CA8A04", LOW: "#16A34A", INFO: "#64748B",
};

export const Dashboard: React.FC = () => {
  const { repoId } = useParams<{ repoId: string }>();
  const [dashboard, setDashboard] = useState<HealthDashboard | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW">("all");

  const fetchData = async () => {
    if (!repoId) return;
    try {
      const [dash, finds] = await Promise.all([
        api.health.dashboard(repoId),
        api.findings.list({ repo_id: repoId, status: "open" }),
      ]);
      setDashboard(dash);
      setFindings(finds);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [repoId]);

  if (loading) return (
    <div style={styles.center}>
      <div style={styles.spinner} />
      <div style={{ color: "#64748B", marginTop: 16, fontSize: 13 }}>Loading dashboard...</div>
    </div>
  );

  if (error || !dashboard) return (
    <div style={styles.center}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 12 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div style={{ color: "#DC2626", fontSize: 15 }}>{error || "Failed to load dashboard"}</div>
    </div>
  );

  const filteredFindings = activeTab === "all"
    ? findings
    : findings.filter((f) => f.severity === activeTab);

  const findingCounts = {
    all: findings.length,
    CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
    HIGH: findings.filter((f) => f.severity === "HIGH").length,
    MEDIUM: findings.filter((f) => f.severity === "MEDIUM").length,
    LOW: findings.filter((f) => f.severity === "LOW").length,
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <Link to="/" style={{ color: "#64748B", textDecoration: "none", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Repositories
          </Link>
          <h1 style={{ color: "#0F172A", margin: "6px 0 4px", fontSize: 22, fontWeight: 700 }}>
            {dashboard.repo_full_name}
          </h1>
          <div style={{ color: "#64748B", fontSize: 12 }}>
            Last updated: {new Date(dashboard.as_of).toLocaleString()}
          </div>
        </div>
        <button
          onClick={fetchData}
          style={styles.refreshBtn}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Top row: Score card + Radar + Activity */}
      <div style={styles.grid3}>
        <HealthScoreCard
          score={dashboard.overall_score}
          grade={dashboard.grade}
          delta7d={dashboard.trend_delta_7d}
          velocity={dashboard.trend_velocity}
        />
        <SubScoreRadar subScores={dashboard.sub_scores} />

        {/* Active Issues Summary */}
        <div style={styles.card}>
          <h3 style={{ color: "#0F172A", margin: "0 0 14px", fontSize: 14, fontWeight: 600 }}>
            Active Issues
          </h3>
          {Object.entries(dashboard.active_findings).map(([sev, count]) =>
            count > 0 ? (
              <div key={sev} style={{
                display: "flex", justifyContent: "space-between",
                padding: "7px 0", borderBottom: "1px solid #E2E8F0",
              }}>
                <span style={{ color: severityTextColor[sev] ?? "#64748B", fontSize: 13, fontWeight: 500 }}>{sev}</span>
                <span style={{ color: "#0F172A", fontWeight: 700, fontSize: 13 }}>{count}</span>
              </div>
            ) : null
          )}
          {Object.values(dashboard.active_findings).every((c) => c === 0) && (
            <div style={{ color: "#16A34A", fontSize: 13 }}>No active issues</div>
          )}

          <div style={{ color: "#64748B", fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginTop: 18, marginBottom: 10 }}>
            Recent Activity
          </div>
          {dashboard.recent_activity.slice(0, 5).map((a, i) => (
            <div key={i} style={{ color: "#64748B", fontSize: 12, padding: "3px 0" }}>
              <span style={{ color: "#0F172A" }}>{a.actor}</span> {a.event.replace(/_/g, " ")}
            </div>
          ))}
        </div>
      </div>

      {/* Second row: Trend + Hot Zones */}
      <div style={styles.grid2}>
        <TrendChart data={dashboard.trend_30d} />
        <HotZoneList zones={dashboard.hot_zones} />
      </div>

      {/* Findings table */}
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const }}>
          {(["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? "#0F172A" : "transparent",
                color: activeTab === tab ? "#FFFFFF" : "#64748B",
                border: activeTab === tab ? "1px solid #0F172A" : "1px solid #E2E8F0",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 500,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 0,
              }}
            >
              {tab === "all" ? "All" : tab}
              {findingCounts[tab] > 0 && (
                <span style={{
                  marginLeft: 6,
                  background: activeTab === tab ? "rgba(255,255,255,0.2)" : "#F1F5F9",
                  color: activeTab === tab ? "#FFFFFF" : "#64748B",
                  borderRadius: 10,
                  padding: "0 6px",
                  fontSize: 11,
                }}>
                  {findingCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        <FindingsTable findings={filteredFindings} onAction={fetchData} />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "32px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1400,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "220px 1fr 1fr",
    gap: 20,
    alignItems: "start",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "60vh",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "2px solid #E2E8F0",
    borderTop: "2px solid #0F172A",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  refreshBtn: {
    background: "transparent",
    border: "1px solid #E2E8F0",
    borderRadius: 8,
    padding: "8px 14px",
    color: "#0F172A",
    cursor: "pointer",
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "background 0.15s",
  },
  card: {
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 3px 0 rgba(0,0,0,0.07)",
  },
};
