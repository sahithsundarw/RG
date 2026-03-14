"""
Repository health dashboard router.

GET  /api/health/{repo_id}          — full dashboard payload
GET  /api/health/{repo_id}/score    — current score only
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.agents.health_aggregator import HealthAggregatorAgent
from backend.models.schemas import HealthDashboard

router = APIRouter(prefix="/api/health", tags=["health"])
_health_agent = HealthAggregatorAgent()


@router.get("/{repo_id}", response_model=HealthDashboard)
async def get_health_dashboard(repo_id: str) -> HealthDashboard:
    """Return the full health dashboard for a repository."""
    dashboard = await _health_agent.get_dashboard(repo_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Repository not found")
    return dashboard


@router.get("/{repo_id}/score")
async def get_health_score(repo_id: str) -> dict:
    """Return just the current health score and grade."""
    dashboard = await _health_agent.get_dashboard(repo_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Repository not found")

    return {
        "repo_id": repo_id,
        "overall_score": dashboard.overall_score,
        "grade": dashboard.grade.value,
        "trend_delta_7d": dashboard.trend_delta_7d,
        "trend_velocity": dashboard.trend_velocity,
    }
