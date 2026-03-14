import React from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace, SavedRepo } from "../hooks/useWorkspace";
import { useTheme } from "../context/ThemeContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function gradeColor(grade?: string): string {
  if (!grade) return "var(--text-muted)";
  if (grade === "A") return "var(--success)";
  if (grade === "B") return "var(--info)";
  if (grade === "C") return "var(--warning)";
  return "var(--danger)";
}

// ── ThemeToggle ──────────────────────────────────────────────────────────────

const ThemeToggle: React.FC = () => {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "6px 10px", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6,
        color: "var(--text-secondary)", fontSize: 12, fontWeight: 500,
        transition: "background 0.15s, border-color 0.15s",
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

// ── Repo Row ─────────────────────────────────────────────────────────────────

const RepoRow: React.FC<{
  repo: SavedRepo;
  onOpen: () => void;
  onRemove: () => void;
}> = ({ repo, onOpen, onRemove }) => {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 20px",
        background: hovered ? "var(--surface-hover)" : "transparent",
        transition: "background 0.15s", cursor: "pointer",
      }}
    >
      {/* Folder icon */}
      <div style={{
        width: 36, height: 36, borderRadius: "var(--radius-md)", flexShrink: 0,
        background: "var(--accent-soft)", border: "1px solid var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
          fontFamily: "'JetBrains Mono','Fira Code',monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: 4,
        }}>
          {repo.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Source badge */}
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em",
            padding: "1px 7px", borderRadius: 20,
            color: repo.source === "flash_audit" ? "var(--success)" : "var(--accent)",
            background: repo.source === "flash_audit" ? "var(--success-soft)" : "var(--accent-soft)",
            border: `1px solid ${repo.source === "flash_audit" ? "var(--success-border)" : "rgba(139,92,246,0.25)"}`,
          }}>
            {repo.source === "flash_audit" ? "Flash Audit" : "Monitoring"}
          </span>
          {/* Timestamp */}
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {timeAgo(repo.addedAt)}
          </span>
        </div>
      </div>

      {/* Score + grade */}
      {repo.lastScore !== undefined && (
        <div style={{ textAlign: "right", flexShrink: 0, marginRight: 4 }}>
          <div style={{
            fontSize: 20, fontWeight: 800, color: "var(--text-primary)",
            lineHeight: 1, letterSpacing: "-0.03em",
          }}>
            {repo.lastScore}
          </div>
          {repo.lastGrade && (
            <div style={{ fontSize: 11, fontWeight: 700, color: gradeColor(repo.lastGrade) }}>
              {repo.lastGrade}
            </div>
          )}
        </div>
      )}

      {/* Open button */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        style={{
          padding: "6px 14px", background: "var(--accent)", color: "var(--accent-text)",
          border: "none", borderRadius: "var(--radius-md)", fontSize: 12, fontWeight: 600,
          cursor: "pointer", flexShrink: 0,
          transition: "background 0.15s, opacity 0.15s",
          opacity: hovered ? 1 : 0.75,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
      >
        Open
      </button>

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove from workspace"
        style={{
          width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-muted)",
          flexShrink: 0, transition: "color 0.15s, border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--danger)";
          e.currentTarget.style.borderColor = "var(--danger-border)";
          e.currentTarget.style.background = "var(--danger-soft)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

export const WorkspaceView: React.FC = () => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { savedRepos, removeRepo } = useWorkspace();

  return (
    <div style={{
      minHeight: "100vh", background: "var(--backdrop)",
      display: "flex", justifyContent: "center", alignItems: "flex-start",
      padding: "28px 24px", boxSizing: "border-box",
    }}>
      <div style={{
        width: "100%", maxWidth: 980,
        background: "var(--bg)", borderRadius: 24, overflow: "clip",
        boxShadow: isDark
          ? "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)"
          : "0 32px 80px rgba(124,58,237,0.18), 0 0 0 1px rgba(190,184,255,0.5)",
        minHeight: "calc(100vh - 56px)",
      }}>

        {/* ── Header ── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 10,
          borderBottom: "1px solid var(--border)", background: "var(--surface)",
          padding: "0 32px", height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          transition: "background 0.2s, border-color 0.2s",
        }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}
            onClick={() => navigate("/")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              RepoGuardian
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
              My Repositories
            </span>
            <ThemeToggle />
          </div>
        </header>

        {/* ── Content ── */}
        <main style={{
          maxWidth: 760, margin: "0 auto", padding: "48px 24px 60px",
          animation: "pageSlide 0.2s ease",
        }}>
          {/* Page title + count */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
            <div>
              <button
                onClick={() => navigate(-1)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "transparent", border: "none", color: "var(--text-muted)",
                  fontSize: 12, cursor: "pointer", padding: "0 0 10px 0",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                </svg>
                Back
              </button>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.03em" }}>
                My Repositories
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                Auto-saved from Flash Audits and Continuous Monitoring.
              </p>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              padding: "4px 12px", borderRadius: 20,
              background: "var(--surface)", border: "1px solid var(--border)",
              flexShrink: 0,
            }}>
              {savedRepos.length} saved
            </div>
          </div>

          {savedRepos.length === 0 ? (
            /* ── Empty state ── */
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "80px 24px", textAlign: "center", gap: 16,
              animation: "fadeIn 0.3s ease",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "var(--radius-lg)",
                background: "var(--surface)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                  No saved repositories yet
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 300 }}>
                  Run a Flash Audit or connect a repo via Continuous Monitoring — they'll appear here automatically.
                </div>
              </div>
              <button
                onClick={() => navigate("/")}
                style={{
                  padding: "9px 22px", background: "var(--accent)", color: "var(--accent-text)",
                  border: "none", borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "background 0.15s", marginTop: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
              >
                Back to Home
              </button>
            </div>
          ) : (
            /* ── Repo list ── */
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)", overflow: "hidden",
              boxShadow: "var(--shadow-sm)",
              animation: "fadeIn 0.3s ease",
            }}>
              {/* Column header */}
              <div style={{
                padding: "10px 20px", borderBottom: "1px solid var(--border)",
                fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.1em",
                display: "grid",
                gridTemplateColumns: "36px 1fr auto auto auto",
                gap: 14, alignItems: "center",
              }}>
                <span />
                <span>Repository</span>
                <span style={{ textAlign: "right", minWidth: 36 }}>Score</span>
                <span style={{ minWidth: 60 }} />
                <span style={{ minWidth: 28 }} />
              </div>

              {savedRepos.map((repo, idx) => (
                <div
                  key={repo.repoUrl}
                  style={{ borderBottom: idx < savedRepos.length - 1 ? "1px solid var(--border)" : "none" }}
                >
                  <RepoRow
                    repo={repo}
                    onOpen={() => navigate(`/repo/${repo.repoId}`)}
                    onRemove={() => removeRepo(repo.repoUrl)}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
