"""
Enums for RepoGuardian.

SQLAlchemy ORM and PostgreSQL have been removed.
All persistence is handled by backend/services/storage.py (in-memory).
"""

from __future__ import annotations

import enum


# ── Enums ──────────────────────────────────────────────────────────────────────


class Platform(str, enum.Enum):
    GITHUB = "github"
    GITLAB = "gitlab"
    BITBUCKET = "bitbucket"


class EventType(str, enum.Enum):
    PR_OPEN = "pr_open"
    PR_UPDATE = "pr_update"
    PUSH_TO_MAIN = "push_to_main"
    SCHEDULED_AUDIT = "scheduled_audit"
    PR_MERGE = "pr_merge"


class Severity(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class FindingCategory(str, enum.Enum):
    BUG = "BUG"
    SECURITY = "SECURITY"
    PERFORMANCE = "PERFORMANCE"
    STYLE = "STYLE"
    LOGIC = "LOGIC"
    DOCUMENTATION = "DOCUMENTATION"
    DEPENDENCY = "DEPENDENCY"
    CODE_SMELL = "CODE_SMELL"
    TEST_COVERAGE = "TEST_COVERAGE"


class FindingStatus(str, enum.Enum):
    OPEN = "open"
    APPROVED = "approved"
    REJECTED = "rejected"
    SNOOZED = "snoozed"
    EXPIRED = "expired"
    AUTO_RESOLVED = "auto_resolved"


class HITLAction(str, enum.Enum):
    POSTED = "posted"
    APPROVED = "approved"
    REJECTED = "rejected"
    SNOOZED = "snoozed"
    EXPIRED = "expired"
    EXPLAINED = "explained"


class HealthGrade(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    F = "F"
