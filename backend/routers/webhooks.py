"""
Webhook ingestion router.

POST /webhooks/github  — receives GitHub webhook events
POST /webhooks/github/comment — receives PR comment events (HITL commands)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status

from backend.config import get_settings
from backend.models.schemas import WebhookEvent
from backend.services.github_service import (
    GitHubAPIClient,
    parse_github_webhook,
    verify_github_signature,
)
from backend.services.redis_service import EventQueueProducer, NullStateStore, StateStore, get_redis

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/github", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_github_event: str = Header(...),
    x_hub_signature_256: str = Header(default=""),
) -> dict:
    """Receive and enqueue a GitHub webhook event."""
    raw_body = await request.body()

    if not verify_github_signature(raw_body, x_hub_signature_256):
        logger.warning("Invalid GitHub webhook signature — rejecting")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    event = parse_github_webhook(x_github_event, payload)
    if event is None:
        return {"status": "ignored", "reason": "unsupported event type or action"}

    background_tasks.add_task(_enqueue_event, event)

    logger.info(
        "Received %s event for %s PR#%s → enqueued",
        x_github_event, event.repo_full_name, event.pr_number,
    )
    return {
        "status": "accepted",
        "event_id": event.event_id,
        "event_type": event.event_type.value,
    }


@router.post("/github/comment", status_code=status.HTTP_200_OK)
async def github_pr_comment_webhook(
    request: Request,
    x_github_event: str = Header(...),
    x_hub_signature_256: str = Header(...),
) -> dict:
    """Handle PR comment events for HITL bot commands."""
    raw_body = await request.body()

    if not verify_github_signature(raw_body, x_hub_signature_256):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )

    if x_github_event not in ("issue_comment", "pull_request_review_comment"):
        return {"status": "ignored"}

    payload = await request.json()
    action = payload.get("action", "")
    if action != "created":
        return {"status": "ignored"}

    comment_body = payload.get("comment", {}).get("body", "")
    commenter = payload.get("comment", {}).get("user", {}).get("login", "unknown")

    command = GitHubAPIClient.parse_bot_command(comment_body)
    if not command:
        return {"status": "no_command"}

    from backend.agents.hitl_gateway import HITLGatewayAgent
    from backend.models.schemas import HITLActionRequest

    try:
        redis = await get_redis()
        state = StateStore(redis)
    except Exception:
        from backend.services.redis_service import NullStateStore
        state = NullStateStore()
    github_client = GitHubAPIClient(settings.github_token)
    gateway = HITLGatewayAgent(github_client, state)

    req = HITLActionRequest(
        action=command["action"],
        reason_code=command.get("reason_code"),
        snooze_days=command.get("snooze_days"),
    )
    try:
        response = await gateway.handle_command(
            finding_id=command["finding_id"],
            request=req,
            actor=commenter,
        )
        logger.info("HITL command '%s' on finding %s by %s",
                    command["action"], command["finding_id"], commenter)
        return {"status": "processed", "message": response.message}
    except Exception as e:
        logger.error("HITL command processing failed: %s", e)
        return {"status": "error", "detail": str(e)}


# ── Background task ────────────────────────────────────────────────────────────

async def _enqueue_event(event: WebhookEvent) -> None:
    """Publish the event to Redis stream, or run flash audit directly as fallback."""
    import backend.services.storage as storage
    from backend.routers.events import broadcast

    # Respect per-repo trigger_events config
    existing = storage.get_repo_by_full_name(event.repo_full_name)
    if existing:
        triggers = existing.get("config", {}).get("trigger_events", {})
        et = event.event_type.value
        if et in ("pr_open", "pr_update") and not triggers.get("pull_requests", True):
            logger.info("PR events disabled for %s — skipping", event.repo_full_name)
            return
        if et == "push_to_main" and not triggers.get("pushes", True):
            logger.info("Push events disabled for %s — skipping", event.repo_full_name)
            return
        if et == "pr_merge" and not triggers.get("merges", False):
            logger.info("Merge events disabled for %s — skipping", event.repo_full_name)
            return

    try:
        redis = await get_redis()
        producer = EventQueueProducer(redis)
        await producer.publish(event)
        logger.info("Event %s enqueued to Redis stream", event.event_id)
    except Exception as e:
        logger.warning(
            "Redis unavailable (%s) — running flash audit directly for %s",
            e, event.repo_full_name,
        )
        from backend.routers.scan import run_audit_for_repo
        clone_url = event.repo_clone_url or f"https://github.com/{event.repo_full_name}.git"
        try:
            result = await run_audit_for_repo(clone_url)
            if result:
                logger.info(
                    "Direct audit complete for %s — score=%s grade=%s findings=%s",
                    event.repo_full_name, result.get("health_score"),
                    result.get("grade"), result.get("total_findings"),
                )
                await broadcast({
                    "type": "webhook_processed",
                    "repo_full_name": event.repo_full_name,
                    "repo_id": result.get("repo_id"),
                    "event_type": event.event_type.value,
                    "health_score": result.get("health_score"),
                    "grade": result.get("grade"),
                    "total_findings": result.get("total_findings"),
                })
        except Exception as audit_err:
            logger.error("Direct audit failed for %s: %s", event.repo_full_name, audit_err)
