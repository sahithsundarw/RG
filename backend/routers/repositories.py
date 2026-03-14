"""
Repository management router.

POST   /api/repositories          — register a new repository
GET    /api/repositories          — list all registered repos
GET    /api/repositories/{repo_id} — get repo details
DELETE /api/repositories/{repo_id} — deactivate a repo
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

import backend.services.storage as storage
from backend.models.schemas import RepositoryCreate, RepositoryResponse

router = APIRouter(prefix="/api/repositories", tags=["repositories"])


@router.post("", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
async def register_repository(body: RepositoryCreate) -> RepositoryResponse:
    """Register a new repository for monitoring."""
    full_name = f"{body.owner}/{body.name}"

    existing = storage.get_repo_by_platform_name(body.platform.value, full_name)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Repository {full_name} is already registered.",
        )

    repo_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    repo = {
        "id": repo_id,
        "platform": body.platform.value,
        "owner": body.owner,
        "name": body.name,
        "full_name": full_name,
        "clone_url": body.clone_url,
        "default_branch": body.default_branch,
        "primary_language": None,
        "is_active": True,
        "config": body.config,
        "created_at": now,
        "updated_at": now,
    }
    storage.save_repo(repo_id, repo)

    return RepositoryResponse(
        id=repo_id,
        platform=body.platform,
        full_name=full_name,
        clone_url=body.clone_url,
        default_branch=body.default_branch,
        primary_language=None,
        is_active=True,
        created_at=now,
    )


@router.get("", response_model=list[RepositoryResponse])
async def list_repositories() -> list[RepositoryResponse]:
    """List all registered repositories."""
    repos = storage.list_repos(active_only=True)
    return [
        RepositoryResponse(
            id=r["id"],
            platform=r["platform"],
            full_name=r["full_name"],
            clone_url=r["clone_url"],
            default_branch=r["default_branch"],
            primary_language=r.get("primary_language"),
            is_active=r.get("is_active", True),
            created_at=r["created_at"],
        )
        for r in repos
    ]


@router.get("/{repo_id}", response_model=RepositoryResponse)
async def get_repository(repo_id: str) -> RepositoryResponse:
    """Get details for a specific repository."""
    repo = storage.get_repo(repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    return RepositoryResponse(
        id=repo["id"],
        platform=repo["platform"],
        full_name=repo["full_name"],
        clone_url=repo["clone_url"],
        default_branch=repo["default_branch"],
        primary_language=repo.get("primary_language"),
        is_active=repo.get("is_active", True),
        created_at=repo["created_at"],
    )


@router.delete("/{repo_id}", status_code=status.HTTP_200_OK)
async def deactivate_repository(repo_id: str) -> dict:
    """Soft-delete (deactivate) a repository."""
    ok = storage.deactivate_repo(repo_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Repository not found")
    return {"status": "deactivated"}
