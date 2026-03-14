"""
HITL Gateway Agent.

Manages the Human-in-the-Loop boundary:
  1. Posts the synthesized report to the PR as comments
  2. Sets the GitHub status check (pending / success / failure)
  3. Persists findings and HITL state to in-memory storage
  4. Handles developer commands (/ai-approve, /ai-reject, etc.)
  5. Audits every action with a full trace
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import backend.services.storage as storage
from backend.config import get_settings
from backend.models.database import (
    FindingCategory,
    FindingStatus,
    HITLAction,
    Severity,
)
from backend.models.schemas import (
    AgentFinding,
    HITLActionRequest,
    HITLActionResponse,
    SynthesizedReport,
    WebhookEvent,
)
from backend.services.github_service import GitHubAPIClient
from backend.services.redis_service import StateStore

logger = logging.getLogger(__name__)
settings = get_settings()


class HITLGatewayAgent:
    """
    Manages the write boundary between AI analysis and GitHub.
    Not a BaseAgent subclass because it doesn't call the LLM.
    """

    name = "hitl_gateway"

    def __init__(self, github_client: GitHubAPIClient, state_store: StateStore) -> None:
        self._github = github_client
        self._state = state_store

    async def post_review(
        self,
        event: WebhookEvent,
        report: SynthesizedReport,
    ) -> list[str]:
        """
        Post the synthesized report to the PR and persist findings to storage.

        Returns list of created finding IDs.
        """
        owner, repo_name = event.repo_full_name.split("/", 1)
        pr_number = event.pr_number
        head_sha = event.head_sha or ""

        # 1. Set status to "pending"
        await self._github.set_commit_status(
            owner, repo_name, head_sha,
            state="pending",
            description="RepoGuardian review in progress...",
        )

        # 2. Persist findings
        finding_ids = self._persist_findings(report, event)

        # 3. Determine verdict
        gh_verdict = self._map_verdict(report.overall_verdict, report.critical_findings)

        # 4. Submit review
        try:
            await self._github.create_review(
                owner, repo_name, pr_number, head_sha,
                verdict=gh_verdict,
                summary_body=report.pr_comment_markdown,
                inline_comments=report.inline_comments[:50],
            )
            logger.info("[hitl_gateway] Review posted to %s PR#%s", event.repo_full_name, pr_number)
        except Exception as e:
            logger.error("[hitl_gateway] Failed to post review: %s", e)
            try:
                await self._github.post_pr_comment(
                    owner, repo_name, pr_number, report.pr_comment_markdown
                )
            except Exception as e2:
                logger.error("[hitl_gateway] Fallback comment also failed: %s", e2)

        # 5. Update commit status
        status_state, status_desc = self._determine_status(report)
        await self._github.set_commit_status(
            owner, repo_name, head_sha,
            state=status_state,
            description=status_desc,
        )

        # 6. Update HITL state in Redis
        for finding_id in finding_ids:
            await self._state.set_finding_status(finding_id, "pending")

        # 7. Audit log
        self._write_audit_log(
            repo_id=str(event.raw_payload.get("repository", {}).get("id", "")),
            event_type="hitl_review_posted",
            actor="ai-system",
            pr_number=pr_number,
            payload={
                "verdict": report.overall_verdict,
                "finding_count": len(report.findings),
                "critical": len(report.critical_findings),
                "high": len(report.high_findings),
                "token_cost": report.total_token_cost,
            },
        )

        return finding_ids

    async def handle_command(
        self,
        finding_id: str,
        request: HITLActionRequest,
        actor: str,
    ) -> HITLActionResponse:
        """
        Process a developer HITL command (approve/reject/snooze/explain).
        Updates storage state and posts a confirmation comment back to GitHub.
        """
        finding = storage.get_finding(finding_id)

        if not finding:
            return HITLActionResponse(
                finding_id=finding_id,
                action=request.action,
                actor=actor,
                timestamp=datetime.now(timezone.utc),
                message=f"Finding {finding_id} not found.",
            )

        action_to_status = {
            "approve": FindingStatus.APPROVED.value,
            "reject": FindingStatus.REJECTED.value,
            "snooze": FindingStatus.SNOOZED.value,
        }
        new_status = action_to_status.get(request.action)

        updates: dict = {}
        if new_status:
            updates["status"] = new_status
            if new_status in (FindingStatus.APPROVED.value, FindingStatus.REJECTED.value):
                updates["resolved_at"] = datetime.now(timezone.utc)
            if new_status == FindingStatus.SNOOZED.value and request.snooze_days:
                updates["snoozed_until"] = datetime.now(timezone.utc) + timedelta(days=request.snooze_days)
        storage.update_finding(finding_id, updates)

        # Record HITL state
        storage.save_hitl_state({
            "id": str(uuid.uuid4()),
            "finding_id": finding_id,
            "action": request.action,
            "actor": actor,
            "reason_code": request.reason_code,
            "comment": request.comment,
            "timestamp": datetime.now(timezone.utc),
        })

        # Update Redis state
        await self._state.set_finding_status(finding_id, request.action)

        # Audit log
        self._write_audit_log(
            repo_id=finding.get("repository_id", ""),
            event_type=f"hitl_{request.action}",
            actor=actor,
            finding_id=finding_id,
            payload={"reason_code": request.reason_code, "comment": request.comment},
        )

        messages = {
            "approve": "Finding accepted. Thank you for the feedback.",
            "reject": "Finding rejected. Your feedback improves our accuracy.",
            "snooze": f"Finding snoozed for {request.snooze_days or 7} days.",
            "explain": "Explanation request noted.",
        }

        return HITLActionResponse(
            finding_id=finding_id,
            action=request.action,
            actor=actor,
            timestamp=datetime.now(timezone.utc),
            message=messages.get(request.action, "Action recorded."),
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _persist_findings(
        self,
        report: SynthesizedReport,
        event: WebhookEvent,
    ) -> list[str]:
        """Persist all findings from the report to in-memory storage."""
        repo = storage.get_repo_by_full_name(event.repo_full_name)
        if not repo:
            logger.error("Repository %s not found in storage", event.repo_full_name)
            return []

        now = datetime.now(timezone.utc)
        finding_ids = []
        for af in report.findings:
            finding = {
                "id": af.finding_id,
                "repository_id": repo["id"],
                "file_path": af.file_path,
                "line_start": af.line_start,
                "line_end": af.line_end,
                "category": af.category.value,
                "severity": af.severity.value,
                "title": af.title,
                "description": af.description,
                "evidence": af.evidence,
                "suggested_fix": af.suggested_fix,
                "reasoning": af.reasoning,
                "cwe_id": af.cwe_id,
                "cve_id": af.cve_id,
                "owasp_category": af.owasp_category,
                "confidence": af.confidence,
                "agent_source": af.agent_source,
                "multi_agent_agreement": af.multi_agent_agreement,
                "status": FindingStatus.OPEN.value,
                "pr_number": event.pr_number,
                "is_suppressed": False,
                "created_at": now,
                "resolved_at": None,
            }
            storage.save_finding(af.finding_id, finding)
            finding_ids.append(af.finding_id)

        return finding_ids

    def _map_verdict(self, verdict: str, critical_findings: list) -> str:
        if verdict == "APPROVE" and not critical_findings:
            return "APPROVE"
        elif verdict == "REQUEST_CHANGES":
            return "REQUEST_CHANGES"
        else:
            return "COMMENT"

    def _determine_status(self, report: SynthesizedReport) -> tuple[str, str]:
        if report.critical_findings and settings.hitl_block_merge_on_critical:
            return "failure", f"❌ {len(report.critical_findings)} critical issues require attention"
        elif report.high_findings:
            return "success", f"⚠️ Review complete — {len(report.high_findings)} high-severity findings"
        elif report.findings:
            return "success", f"✅ Review complete — {len(report.findings)} minor findings"
        else:
            return "success", "✅ RepoGuardian review complete — no significant issues"

    def _write_audit_log(
        self,
        repo_id: str,
        event_type: str,
        actor: str,
        pr_number: int | None = None,
        finding_id: str | None = None,
        payload: dict | None = None,
    ) -> None:
        storage.save_audit_log({
            "id": str(uuid.uuid4()),
            "repository_id": repo_id,
            "timestamp": datetime.now(timezone.utc),
            "event_type": event_type,
            "actor": actor,
            "pr_number": pr_number,
            "finding_id": finding_id,
            "agent_name": self.name,
            "payload": payload or {},
        })
