"""
Findings router.

GET  /api/findings                  — list findings (filterable)
GET  /api/findings/{finding_id}     — get single finding details
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

import backend.services.storage as storage
from backend.models.database import FindingStatus, Severity
from backend.models.schemas import FindingResponse

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
