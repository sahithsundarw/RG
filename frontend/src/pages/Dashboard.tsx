import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, HealthDashboard, Finding } from "../api/client";
import { HealthScoreCard } from "../components/HealthScoreCard";
import { SubScoreRadar } from "../components/SubScoreRadar";
import { FindingsTable } from "../components/FindingsTable";
import { TrendChart } from "../components/TrendChart";
import { HotZoneList } from "../components/HotZoneList";
import { useTheme } from "../context/ThemeContext";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#F59E0B",
  MEDIUM:   "#CA8A04",
  LOW:      "var(--success)",
  INFO:     "var(--text-muted)",
};

// ── Theme toggle (same as RepositoryList) ───────────────────────────────────

const ThemeToggle: React.FC = () => {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "6px 10px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 500,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
    >
      {isDark ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {isDark ? "Light" : "Dark"}
    </button>
  );
};

// ── Skeleton loader ─────────────────────────────────────────────────────────

const DashboardSkeleton: React.FC = () => (
  <div style={{ padding: "0 40px 40px", animation: "fadeIn 0.3s ease" }}>
    <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
      <div className="skeleton" style={{ height: 14, width: 100 }} />
      <div className="skeleton" style={{ height: 20, width: 220 }} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr", gap: 16, marginBottom: 16 }}>
      <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
      <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
      <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
      <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />
      <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />
    </div>
    <div className="skeleton" style={{ height: 320, borderRadius: 12 }} />
  </div>
);

// ── Main component ──────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const { repoId } = useParams<{ repoId: string }>();
  const [dashboard, setDashboard] = useState<HealthDashboard | null>(null);
  const [findings,  setFindings]  = useState<Finding[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
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
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Minimal header while loading */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0 40px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div className="skeleton" style={{ height: 14, width: 160 }} />
        <ThemeToggle />
      </header>
      <DashboardSkeleton />
    </div>
  );

  if (error || !dashboard) return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div style={{ color: "var(--danger)", fontSize: 14 }}>{error || "Failed to load dashboard"}</div>
      <Link to="/" style={{ fontSize: 13, color: "var(--text-muted)" }}>← Back to home</Link>
    </div>
  );

  const filteredFindings = activeTab === "all"
    ? findings
    : findings.filter((f) => f.severity === activeTab);

  const findingCounts = {
    all:      findings.length,
    CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
    HIGH:     findings.filter((f) => f.severity === "HIGH").length,
    MEDIUM:   findings.filter((f) => f.severity === "MEDIUM").length,
    LOW:      findings.filter((f) => f.severity === "LOW").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ── */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0 40px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 10,
        transition: "background 0.2s, border-color 0.2s",
      }}>
        <div style={{ display: "flex", align: "center", gap: 16, alignItems: "center" } as React.CSSProperties}>
          <Link
            to="/"
            style={{
              color: "var(--text-muted)",
              textDecoration: "none",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Repositories
          </Link>
          <span style={{ color: "var(--border)", fontSize: 16 }}>·</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            {dashboard.repo_full_name}
          </span>
          <span style={{
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
            padding: "2px 8px",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}>
            {new Date(dashboard.as_of).toLocaleString()}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={fetchData}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "6px 12px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            Refresh
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Page content ── */}
      <div style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "32px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        animation: "fadeIn 0.3s ease",
      }}>

        {/* ── Stat strip ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            {
              label: "Health Score",
              value: `${Math.round(dashboard.overall_score)}`,
              sub: dashboard.grade,
              color: "var(--text-primary)",
            },
            {
              label: "Total Findings",
              value: `${findingCounts.all}`,
              sub: "open",
              color: "var(--text-primary)",
            },
            {
              label: "Critical",
              value: `${findingCounts.CRITICAL}`,
              sub: findingCounts.CRITICAL > 0 ? "needs attention" : "none",
              color: findingCounts.CRITICAL > 0 ? "var(--danger)" : "var(--success)",
            },
            {
              label: "7-day trend",
              value: `${dashboard.trend_delta_7d > 0 ? "+" : ""}${dashboard.trend_delta_7d.toFixed(1)}`,
              sub: dashboard.trend_velocity.toLowerCase(),
              color: dashboard.trend_delta_7d >= 0 ? "var(--success)" : "var(--danger)",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "18px 20px",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                {stat.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: stat.color, lineHeight: 1, letterSpacing: "-0.02em", marginBottom: 4 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Row 1: Score card + Radar + Active issues ── */}
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr", gap: 16, alignItems: "start" }}>
          <HealthScoreCard
            score={dashboard.overall_score}
            grade={dashboard.grade}
            delta7d={dashboard.trend_delta_7d}
            velocity={dashboard.trend_velocity}
          />
          <SubScoreRadar subScores={dashboard.sub_scores} />

          {/* Active issues + recent activity */}
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "20px 20px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14 }}>
              Active Issues
            </div>
            {Object.entries(dashboard.active_findings).map(([sev, count]) =>
              count > 0 ? (
                <div key={sev} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ color: SEV_COLOR[sev] ?? "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>
                    {sev}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 13 }}>{count}</span>
                </div>
              ) : null
            )}
            {Object.values(dashboard.active_findings).every((c) => c === 0) && (
              <div style={{ color: "var(--success)", fontSize: 13, padding: "4px 0" }}>No active issues</div>
            )}

            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginTop: 18,
              marginBottom: 10,
            }}>
              Recent Activity
            </div>
            {dashboard.recent_activity.slice(0, 5).map((a, i) => (
              <div key={i} style={{ color: "var(--text-muted)", fontSize: 12, padding: "4px 0" }}>
                <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{a.actor}</span>{" "}
                {a.event.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        </div>

        {/* ── Row 2: Trend + Hot zones ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TrendChart data={dashboard.trend_30d} />
          <HotZoneList zones={dashboard.hot_zones} />
        </div>

        {/* ── Findings table ── */}
        <div>
          {/* Tab filter */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {(["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: isActive ? "var(--accent)" : "transparent",
                    color: isActive ? "var(--accent-text)" : "var(--text-secondary)",
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "background 0.15s, color 0.15s, border-color 0.15s",
                  }}
                >
                  {tab === "all" ? "All" : tab}
                  {findingCounts[tab] > 0 && (
                    <span style={{
                      background: isActive ? "rgba(255,255,255,0.2)" : "var(--bg-alt)",
                      color: isActive ? "var(--accent-text)" : "var(--text-muted)",
                      borderRadius: 10,
                      padding: "0 5px",
                      fontSize: 10,
                      fontWeight: 600,
                    }}>
                      {findingCounts[tab]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <FindingsTable findings={filteredFindings} onAction={fetchData} />
        </div>
      </div>
    </div>
  );
};
