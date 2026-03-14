"""
Findings router.

GET  /api/findings                  — list findings (filterable)
GET  /api/findings/{finding_id}     — get single finding details
POST /api/findings/{finding_id}/explain — LLM risk explanation (cached)
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query

import backend.services.storage as storage
from backend.config import get_settings
from backend.models.database import FindingStatus, Severity
from backend.models.schemas import FindingResponse

logger = logging.getLogger(__name__)
settings = get_settings()
_executor = ThreadPoolExecutor(max_workers=2)

router = APIRouter(prefix="/api/findings", tags=["findings"])


@router.get("", response_model=list[FindingResponse])
async def list_findings(
    repo_id: str | None = Query(None),
    severity: str | None = Query(None),
    status: str | None = Query(None),
    pr_number: int | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
) -> list[FindingResponse]:
    """List findings with optional filters."""
    # Validate enums before querying
    sev_value = None
    if severity:
        try:
            sev_value = Severity(severity.upper()).value
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid severity: {severity}")

    status_value = None
    if status:
        try:
            status_value = FindingStatus(status.lower()).value
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    results = storage.list_findings(
        repo_id=repo_id,
        severity=sev_value,
        status=status_value,
        pr_number=pr_number,
        limit=limit,
        offset=offset,
    )

    return [
        FindingResponse(
            id=f["id"],
            repository_id=f["repository_id"],
            file_path=f.get("file_path"),
            line_start=f.get("line_start"),
            line_end=f.get("line_end"),
            category=f["category"],
            severity=f["severity"],
            title=f["title"],
            description=f["description"],
            evidence=f.get("evidence"),
            suggested_fix=f.get("suggested_fix"),
            reasoning=f.get("reasoning"),
            cwe_id=f.get("cwe_id"),
            confidence=f["confidence"],
            agent_source=f["agent_source"],
            status=f["status"],
            pr_number=f.get("pr_number"),
            created_at=f["created_at"],
            resolved_at=f.get("resolved_at"),
        )
        for f in results
    ]


@router.get("/{finding_id}", response_model=FindingResponse)
async def get_finding(finding_id: str) -> FindingResponse:
    """Get a single finding by ID."""
    f = storage.get_finding(finding_id)
    if not f:
        raise HTTPException(status_code=404, detail="Finding not found")

    return FindingResponse(
        id=f["id"],
        repository_id=f["repository_id"],
        file_path=f.get("file_path"),
        line_start=f.get("line_start"),
        line_end=f.get("line_end"),
        category=f["category"],
        severity=f["severity"],
        title=f["title"],
        description=f["description"],
        evidence=f.get("evidence"),
        suggested_fix=f.get("suggested_fix"),
        reasoning=f.get("reasoning"),
        cwe_id=f.get("cwe_id"),
        confidence=f["confidence"],
        agent_source=f["agent_source"],
        status=f["status"],
        pr_number=f.get("pr_number"),
        created_at=f["created_at"],
        resolved_at=f.get("resolved_at"),
    )


@router.post("/{finding_id}/explain")
async def explain_finding(finding_id: str) -> dict:
    """Return an LLM-generated plain-English risk explanation for a finding.

    Results are cached in memory — subsequent calls return instantly.
    Falls back to a template when OpenAI is not configured.
    """
    f = storage.get_finding(finding_id)
    if not f:
        raise HTTPException(status_code=404, detail="Finding not found")

    cached = storage.get_explanation(finding_id)
    if cached:
        return {"explanation": cached, "cached": True}

    prompt = (
        f"You are a security engineer explaining a code finding to a developer.\n\n"
        f"Finding: {f['title']}\n"
        f"Severity: {f['severity']}\n"
        f"Category: {f['category']}\n"
        f"Description: {f['description']}\n"
        f"File: {f.get('file_path', 'unknown')} line {f.get('line_start', '?')}\n"
        f"Evidence: {f.get('evidence') or 'none'}\n"
        f"Suggested Fix: {f.get('suggested_fix') or 'none'}\n\n"
        "In 3-4 sentences explain:\n"
        "1. What the risk is and why it matters.\n"
        "2. What an attacker could do if this is not fixed.\n"
        "3. The simplest action the developer should take.\n\n"
        "Be specific, actionable, and jargon-free."
    )

    if not settings.openai_api_key:
        explanation = (
            f"This {f['severity']} severity {f['category']} finding was detected in "
            f"{f.get('file_path', 'the codebase')}. {f['description']} "
            f"{f.get('suggested_fix', 'Review and remediate the affected code.')}"
        )
    else:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=settings.openai_api_key)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _executor,
                lambda: client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=300,
                ),
            )
            explanation = response.choices[0].message.content or ""
        except Exception as e:
            logger.warning("LLM explain failed for finding %s: %s", finding_id, e)
            explanation = (
                f"This {f['severity']} finding: {f['description']} "
                f"Suggested fix: {f.get('suggested_fix', 'Review the affected code.')}"
            )

    storage.save_explanation(finding_id, explanation)
    logger.info("[findings] Generated explanation for finding %s", finding_id)
    return {"explanation": explanation, "cached": False}
