"""
Repository management router.

POST   /api/repositories                  — register a new repository
GET    /api/repositories                  — list all registered repos
GET    /api/repositories/{repo_id}        — get repo details
DELETE /api/repositories/{repo_id}        — deactivate a repo
POST   /api/repositories/detect-projects  — detect sub-projects in a repo
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

import backend.services.storage as storage
from backend.models.schemas import RepositoryCreate, RepositoryResponse
from backend.utils.project_detector import detect_projects

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/repositories", tags=["repositories"])


# ── Detect-projects schemas ────────────────────────────────────────────────────

class DetectProjectsRequest(BaseModel):
    repo_url: str


class DetectedProject(BaseModel):
    name: str
    path: str
    language: str


class DetectProjectsResponse(BaseModel):
    projects: list[DetectedProject]


@router.post("", response_model=RepositoryResponse, status_code=status.HTTP_200_OK)
async def register_repository(body: RepositoryCreate) -> RepositoryResponse:
    """Register a new repository for monitoring."""
    if not body.owner or not body.name:
        raise HTTPException(status_code=422, detail="owner and name must not be empty")

    full_name = f"{body.owner}/{body.name}"

    existing = storage.get_repo_by_platform_name(body.platform.value, full_name)
    if existing:
        return RepositoryResponse(
            id=existing["id"],
            platform=existing["platform"],
            full_name=existing["full_name"],
            clone_url=existing["clone_url"],
            default_branch=existing["default_branch"],
            primary_language=existing.get("primary_language"),
            is_active=existing.get("is_active", True),
            created_at=existing["created_at"],
            config=existing.get("config", {}),
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
        config=body.config,
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
            config=r.get("config", {}),
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
        config=repo.get("config", {}),
    )


@router.delete("/{repo_id}", status_code=status.HTTP_200_OK)
async def deactivate_repository(repo_id: str) -> dict:
    """Soft-delete (deactivate) a repository."""
    ok = storage.deactivate_repo(repo_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Repository not found")
    return {"status": "deactivated"}


# ── Project detection endpoint ─────────────────────────────────────────────────


@router.post("/detect-projects", response_model=DetectProjectsResponse)
async def detect_repo_projects(body: DetectProjectsRequest) -> DetectProjectsResponse:
    """Shallow-clone a repository and detect top-level sub-projects.

    Returns a list of candidate projects based on the presence of well-known
    project indicator files (package.json, requirements.txt, go.mod, etc.).
    Detection completes in 1-2 seconds thanks to a shallow clone.
    """
    repo_url = body.repo_url.strip()

    with tempfile.TemporaryDirectory() as tmpdir:
        # Shallow clone — only need directory structure, no history
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", "--filter=blob:none",
            "--no-checkout", repo_url, tmpdir,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        except asyncio.TimeoutError:
            logger.warning("[detect-projects] Clone timed out for %s", repo_url)
            raise HTTPException(status_code=408, detail="Repository clone timed out")

        if proc.returncode != 0:
            err = stderr.decode()[:300]
            logger.warning("[detect-projects] Clone failed for %s: %s", repo_url, err)
            raise HTTPException(status_code=422, detail=f"Could not clone repository: {err}")

        # Checkout only the tree (no blobs) so we can read directory layout
        proc2 = await asyncio.create_subprocess_exec(
            "git", "-C", tmpdir, "checkout",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc2.communicate(), timeout=30)

        projects = detect_projects(tmpdir)
        logger.info("[detect-projects] Found %d projects in %s", len(projects), repo_url)

    return DetectProjectsResponse(
        projects=[DetectedProject(**p) for p in projects]
    )
