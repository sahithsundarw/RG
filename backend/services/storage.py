"""
In-memory storage layer (replaces PostgreSQL/SQLAlchemy).

This is a temporary persistence layer that keeps all data in process memory.
Data is lost on restart. Replace with a real database when needed.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

# ── In-memory stores ───────────────────────────────────────────────────────────

_repos: dict[str, dict] = {}           # repo_id (str) -> repo dict
_findings: dict[str, dict] = {}        # finding_id (str) -> finding dict
_health_records: list[dict] = []       # list of health record dicts
_hitl_states: list[dict] = []          # list of HITL state dicts
_audit_logs: list[dict] = []           # list of audit log dicts
_explanations: dict[str, str] = {}     # finding_id (str) -> LLM explanation text


# ── Repository operations ──────────────────────────────────────────────────────

def save_repo(repo_id: str, data: dict) -> None:
    _repos[repo_id] = data


def get_repo(repo_id: str) -> Optional[dict]:
    return _repos.get(repo_id)


def get_repo_by_full_name(full_name: str) -> Optional[dict]:
    for r in _repos.values():
        if r.get("full_name") == full_name:
            return r
    return None


def get_repo_by_platform_name(platform: str, full_name: str) -> Optional[dict]:
    for r in _repos.values():
        if r.get("platform") == platform and r.get("full_name") == full_name:
            return r
    return None


def list_repos(active_only: bool = True) -> list[dict]:
    repos = list(_repos.values())
    if active_only:
        repos = [r for r in repos if r.get("is_active", True)]
    return repos


def deactivate_repo(repo_id: str) -> bool:
    if repo_id in _repos:
        _repos[repo_id]["is_active"] = False
        return True
    return False


# ── Finding operations ─────────────────────────────────────────────────────────

def save_finding(finding_id: str, data: dict) -> None:
    _findings[finding_id] = data


def get_finding(finding_id: str) -> Optional[dict]:
    return _findings.get(finding_id)


def update_finding(finding_id: str, updates: dict) -> bool:
    if finding_id in _findings:
        _findings[finding_id].update(updates)
        return True
    return False


def list_findings(
    repo_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    pr_number: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    results = list(_findings.values())
    if repo_id:
        results = [f for f in results if f.get("repository_id") == repo_id]
    if severity:
        results = [f for f in results if f.get("severity") == severity]
    if status:
        results = [f for f in results if f.get("status") == status]
    if pr_number is not None:
        results = [f for f in results if f.get("pr_number") == pr_number]
    results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return results[offset: offset + limit]


# ── Health record operations ───────────────────────────────────────────────────

def save_health_record(data: dict) -> None:
    _health_records.append(data)


def get_latest_health_record(repo_id: str) -> Optional[dict]:
    records = [r for r in _health_records if r.get("repository_id") == repo_id]
    if not records:
        return None
    return max(records, key=lambda r: r.get("timestamp", datetime.min))


def get_health_trend(repo_id: str, limit: int = 30) -> list[dict]:
    records = [r for r in _health_records if r.get("repository_id") == repo_id]
    records.sort(key=lambda r: r.get("timestamp", datetime.min), reverse=True)
    return records[:limit]


# ── HITL state operations ──────────────────────────────────────────────────────

def save_hitl_state(data: dict) -> None:
    _hitl_states.append(data)


# ── Audit log operations ───────────────────────────────────────────────────────

def save_audit_log(data: dict) -> None:
    _audit_logs.append(data)


def get_audit_logs(repo_id: str, limit: int = 10) -> list[dict]:
    logs = [lg for lg in _audit_logs if lg.get("repository_id") == repo_id]
    logs.sort(key=lambda lg: lg.get("timestamp", datetime.min), reverse=True)
    return logs[:limit]


# ── Explanation cache operations ───────────────────────────────────────────────

def save_explanation(finding_id: str, text: str) -> None:
    _explanations[finding_id] = text


def get_explanation(finding_id: str) -> Optional[str]:
    return _explanations.get(finding_id)
