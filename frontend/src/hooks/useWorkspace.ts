import { useState, useCallback } from "react";

const REPOS_KEY = "rg-saved-repos";

export interface SavedRepo {
  repoUrl: string;
  repoId: string;
  name: string;        // "owner/repo" extracted from URL
  addedAt: string;     // ISO timestamp
  lastScore?: number;
  lastGrade?: string;
  source: "flash_audit" | "monitoring";
}

function loadFromStorage(): SavedRepo[] {
  try {
    const raw = localStorage.getItem(REPOS_KEY);
    return raw ? (JSON.parse(raw) as SavedRepo[]) : [];
  } catch {
    return [];
  }
}

function persistToStorage(repos: SavedRepo[]) {
  try {
    localStorage.setItem(REPOS_KEY, JSON.stringify(repos));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}

function extractRepoName(repoUrl: string): string {
  try {
    const { pathname } = new URL(repoUrl);
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    if (parts.length === 1) return parts[0];
  } catch { /* fall through */ }
  return repoUrl;
}

export function useWorkspace() {
  const [savedRepos, setSavedRepos] = useState<SavedRepo[]>(loadFromStorage);

  /** Upsert a repo by URL — most recent scan wins, always surfaces to top. */
  const saveRepo = useCallback((
    repoUrl: string,
    repoId: string,
    source: SavedRepo["source"],
    lastScore?: number,
    lastGrade?: string,
  ) => {
    setSavedRepos((prev) => {
      const entry: SavedRepo = {
        repoUrl,
        repoId,
        name: extractRepoName(repoUrl),
        addedAt: new Date().toISOString(),
        source,
        lastScore,
        lastGrade,
      };
      // Remove old entry for same URL (upsert), prepend fresh one
      const updated = [entry, ...prev.filter((r) => r.repoUrl !== repoUrl)];
      persistToStorage(updated);
      return updated;
    });
  }, []);

  /** Remove a saved repo by URL, updating storage and UI instantly. */
  const removeRepo = useCallback((repoUrl: string) => {
    setSavedRepos((prev) => {
      const updated = prev.filter((r) => r.repoUrl !== repoUrl);
      persistToStorage(updated);
      return updated;
    });
  }, []);

  return { savedRepos, saveRepo, removeRepo };
}
