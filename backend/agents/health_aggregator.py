"""
Health Aggregator Agent.

Computes and persists the Repository Health Score after every analysis cycle.

Health Score (0–100):
  = weighted_average(sub_scores) penalised by active findings

Sub-scores:
  code_quality    × 0.25
  security        × 0.30
  dependencies    × 0.20
  documentation   × 0.15
  test_coverage   × 0.10
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

import backend.services.storage as storage
from backend.config import get_settings
from backend.models.database import (
    FindingCategory,
    FindingStatus,
    HealthGrade,
    Severity,
)
from backend.models.schemas import (
    HealthDashboard,
    HotZoneFile,
    SubScores,
    SynthesizedReport,
    TrendPoint,
)

logger = logging.getLogger(__name__)
settings = get_settings()


# Category → sub-score mapping
_CATEGORY_TO_SUBSCORE = {
    FindingCategory.BUG.value:           "code_quality",
    FindingCategory.LOGIC.value:         "code_quality",
    FindingCategory.PERFORMANCE.value:   "code_quality",
    FindingCategory.STYLE.value:         "code_quality",
    FindingCategory.CODE_SMELL.value:    "code_quality",
    FindingCategory.SECURITY.value:      "security",
    FindingCategory.DEPENDENCY.value:    "dependencies",
    FindingCategory.DOCUMENTATION.value: "documentation",
}


class HealthAggregatorAgent:
    """Computes, persists, and retrieves repository health records."""

    name = "health_aggregator"

    async def update_health_score(
        self,
        repo_id: str,
        report: SynthesizedReport,
        event_label: str,
    ) -> dict:
        """Compute a new health score and persist it to in-memory storage."""
        sub_scores = self._compute_sub_scores(report)
        overall = self._weighted_composite(sub_scores)
        grade = self._score_to_grade(overall)

        record = {
            "id": str(uuid.uuid4()),
            "repository_id": repo_id,
            "timestamp": datetime.now(timezone.utc),
            "overall_score": round(overall, 1),
            "grade": grade.value,
            "score_code_quality": round(sub_scores["code_quality"], 1),
            "score_security": round(sub_scores["security"], 1),
            "score_dependencies": round(sub_scores["dependencies"], 1),
            "score_documentation": round(sub_scores["documentation"], 1),
            "score_test_coverage": round(sub_scores["test_coverage"], 1),
            "critical_count": len(report.critical_findings),
            "high_count": len(report.high_findings),
            "medium_count": len(report.medium_findings),
            "low_count": len(report.low_findings),
            "info_count": len(report.info_findings),
            "trigger_event": event_label,
            "trigger_pr_number": report.pr_number,
            "metadata": {
                "verdict": report.overall_verdict,
                "token_cost": report.total_token_cost,
                "files_reviewed": len({f.file_path for f in report.findings if f.file_path}),
            },
        }

        storage.save_health_record(record)
        logger.info(
            "[health_aggregator] Health score for repo %s: %.1f (%s)",
            repo_id, overall, grade.value,
        )
        return record

    async def get_dashboard(self, repo_id: str) -> HealthDashboard | None:
        """Build the full dashboard payload for a repository."""
        repo = storage.get_repo(repo_id)
        if not repo:
            return None

        latest = storage.get_latest_health_record(repo_id)

        if not latest:
            return HealthDashboard(
                repo_id=repo_id,
                repo_full_name=repo["full_name"],
                as_of=datetime.now(timezone.utc),
                overall_score=100.0,
                grade=HealthGrade.A,
                sub_scores=SubScores(
                    code_quality=100, security=100, dependencies=100,
                    documentation=100, test_coverage=100,
                ),
                active_findings={},
                hot_zones=[],
                trend_30d=[],
                trend_delta_7d=0.0,
                trend_velocity="STABLE",
                recent_activity=[],
            )

        # 30-day trend
        trend_records = storage.get_health_trend(repo_id, limit=30)
        trend_points = [
            TrendPoint(
                timestamp=r["timestamp"],
                overall_score=r["overall_score"],
                grade=r["grade"],
            )
            for r in reversed(trend_records)
        ]

        # 7-day delta
        seven_day_delta = 0.0
        if len(trend_records) >= 7:
            seven_day_delta = round(
                trend_records[0]["overall_score"] - trend_records[6]["overall_score"], 1
            )

        velocity = (
            "IMPROVING" if seven_day_delta > 2
            else "DEGRADING" if seven_day_delta < -2
            else "STABLE"
        )

        # Active findings count by severity
        active_findings_raw = storage.list_findings(
            repo_id=repo_id,
            status=FindingStatus.OPEN.value,
            limit=10000,
        )
        active_findings_raw = [
            f for f in active_findings_raw if not f.get("is_suppressed", False)
        ]
        sev_counts: dict[str, int] = defaultdict(int)
        for f in active_findings_raw:
            sev_counts[f["severity"]] += 1
        active_findings = {sev.value: sev_counts.get(sev.value, 0) for sev in Severity}

        # Hot zones
        hot_zones = self._compute_hot_zones(active_findings_raw)

        # Recent audit logs
        recent_logs = storage.get_audit_logs(repo_id, limit=10)
        recent_activity = [
            {
                "timestamp": lg["timestamp"].isoformat() if isinstance(lg["timestamp"], datetime) else lg["timestamp"],
                "event": lg["event_type"],
                "actor": lg["actor"],
            }
            for lg in recent_logs
        ]

        return HealthDashboard(
            repo_id=repo_id,
            repo_full_name=repo["full_name"],
            as_of=latest["timestamp"],
            overall_score=latest["overall_score"],
            grade=HealthGrade(latest["grade"]),
            sub_scores=SubScores(
                code_quality=latest["score_code_quality"],
                security=latest["score_security"],
                dependencies=latest["score_dependencies"],
                documentation=latest["score_documentation"],
                test_coverage=latest["score_test_coverage"],
            ),
            active_findings=active_findings,
            hot_zones=hot_zones,
            trend_30d=trend_points,
            trend_delta_7d=seven_day_delta,
            trend_velocity=velocity,
            recent_activity=recent_activity,
        )

    # ── Score computation ──────────────────────────────────────────────────────

    def _compute_sub_scores(self, report: SynthesizedReport) -> dict[str, float]:
        scores = {
            "code_quality": 100.0,
            "security":     100.0,
            "dependencies": 100.0,
            "documentation": 100.0,
            "test_coverage": 100.0,
        }

        penalty_map = {
            Severity.CRITICAL.value: settings.health_penalty_critical,
            Severity.HIGH.value:     settings.health_penalty_high,
            Severity.MEDIUM.value:   settings.health_penalty_medium,
            Severity.LOW.value:      settings.health_penalty_low,
            Severity.INFO.value:     settings.health_penalty_info,
        }

        for finding in report.findings:
            sub = _CATEGORY_TO_SUBSCORE.get(finding.category.value, "code_quality")
            penalty = penalty_map.get(finding.severity.value, 0)
            scores[sub] = max(0.0, scores[sub] - penalty)

        return scores

    def _weighted_composite(self, sub_scores: dict[str, float]) -> float:
        return (
            sub_scores["code_quality"]    * settings.health_weight_code_quality
            + sub_scores["security"]      * settings.health_weight_security
            + sub_scores["dependencies"]  * settings.health_weight_dependencies
            + sub_scores["documentation"] * settings.health_weight_documentation
            + sub_scores["test_coverage"] * settings.health_weight_test_coverage
        )

    def _score_to_grade(self, score: float) -> HealthGrade:
        if score >= 90:
            return HealthGrade.A
        elif score >= 75:
            return HealthGrade.B
        elif score >= 60:
            return HealthGrade.C
        elif score >= 40:
            return HealthGrade.D
        else:
            return HealthGrade.F

    def _compute_hot_zones(self, findings: list[dict]) -> list[HotZoneFile]:
        """Find the files with the most active findings."""
        file_data: dict[str, dict] = {}
        weight = {
            Severity.CRITICAL.value: 10,
            Severity.HIGH.value: 5,
            Severity.MEDIUM.value: 2,
        }

        for f in findings:
            fp = f.get("file_path")
            if not fp:
                continue
            if fp not in file_data:
                file_data[fp] = {"count": 0, "risk": 0, "critical": 0, "high": 0}
            file_data[fp]["count"] += 1
            file_data[fp]["risk"] += weight.get(f.get("severity", ""), 1)
            if f.get("severity") == Severity.CRITICAL.value:
                file_data[fp]["critical"] += 1
            if f.get("severity") == Severity.HIGH.value:
                file_data[fp]["high"] += 1

        sorted_files = sorted(file_data.items(), key=lambda x: x[1]["risk"], reverse=True)[:10]
        return [
            HotZoneFile(
                file_path=fp,
                risk_score=float(data["risk"]),
                finding_count=data["count"],
                critical_count=data["critical"],
                high_count=data["high"],
            )
            for fp, data in sorted_files
        ]
