"""
Flash Audit router — on-demand repository scan with SSE streaming.

POST /api/scan               — start a scan, returns scan_id
GET  /api/scan/{id}/stream   — SSE progress stream
GET  /api/scan/{id}/result   — fetch final result
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api/scan", tags=["scan"])

_executor = ThreadPoolExecutor(max_workers=4)

# In-memory scan store  { scan_id: {"status", "queue", "result", "error"} }
_scans: dict[str, dict] = {}


# ── Request / Response schemas ─────────────────────────────────────────────────


class ScanRequest(BaseModel):
    repo_url: str


class ScanStartResponse(BaseModel):
    scan_id: str
    status: str


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.post("", response_model=ScanStartResponse)
async def start_scan(body: ScanRequest, background_tasks: BackgroundTasks) -> ScanStartResponse:
    """Start a Flash Audit for a public GitHub repository."""
    scan_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _scans[scan_id] = {"status": "queued", "queue": queue, "result": None, "error": None}
    background_tasks.add_task(_run_flash_audit, scan_id, body.repo_url, queue)
    return ScanStartResponse(scan_id=scan_id, status="queued")


@router.get("/{scan_id}/stream")
async def stream_scan_progress(scan_id: str) -> StreamingResponse:
    """SSE stream for real-time audit progress updates."""
    if scan_id not in _scans:
        raise HTTPException(status_code=404, detail="Scan not found")

    async def event_generator() -> AsyncIterator[str]:
        q = _scans[scan_id]["queue"]
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=120.0)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{scan_id}/result")
async def get_scan_result(scan_id: str) -> dict:
    """Fetch the completed audit result."""
    if scan_id not in _scans:
        raise HTTPException(status_code=404, detail="Scan not found")
    scan = _scans[scan_id]
    if scan["status"] == "running":
        return {"status": "running"}
    if scan["error"]:
        return {"status": "error", "error": scan["error"]}
    return {"status": "complete", "result": scan["result"]}


# ── Flash Audit Pipeline ───────────────────────────────────────────────────────


def _parse_github_url(url: str) -> tuple[str, str]:
    m = re.search(r"github\.com[:/]([^/]+)/([^/\s\.]+?)(?:\.git)?$", url)
    if not m:
        raise ValueError(f"Cannot parse GitHub URL: {url!r}. Expected https://github.com/owner/repo")
    return m.group(1), m.group(2)


async def _run_flash_audit(scan_id: str, repo_url: str, queue: asyncio.Queue) -> None:
    scan = _scans[scan_id]
    scan["status"] = "running"

    async def emit(msg: str, type_: str = "progress", extra: dict | None = None) -> None:
        event: dict = {"type": type_, "message": msg, **(extra or {})}
        await queue.put(event)

    try:
        try:
            owner, repo_name = _parse_github_url(repo_url)
        except ValueError as e:
            await emit(str(e), "error")
            scan.update(status="error", error=str(e))
            return

        repo_full_name = f"{owner}/{repo_name}"
        await emit(f"Starting flash audit for {repo_full_name}")

        with tempfile.TemporaryDirectory() as tmpdir:
            # ── Step 1: Shallow clone ──────────────────────────────────────────
            await emit("Cloning repository (shallow clone)...")
            clone_url = f"https://github.com/{repo_full_name}.git"
            try:
                proc = await asyncio.create_subprocess_exec(
                    "git", "clone", "--depth", "1", clone_url, tmpdir,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
                if proc.returncode != 0:
                    err = f"Clone failed: {stderr.decode()[:300]}"
                    await emit(err, "error")
                    scan.update(status="error", error=err)
                    return
            except asyncio.TimeoutError:
                await emit("Clone timed out after 120s", "error")
                scan.update(status="error", error="Clone timed out")
                return

            await emit("Repository cloned. Running static analysis...")

            # ── Step 2: Layer 1 — Static analysis tools ────────────────────────
            await emit("Security Scan Agent running (bandit)...")
            security_findings = await _run_bandit(tmpdir)
            await emit(f"Security scan complete — {len(security_findings)} issues found")

            await emit("Code Quality Agent running (radon)...")
            quality_findings = await _run_radon(tmpdir)
            await emit(f"Code quality analysis complete — {len(quality_findings)} issues found")

            await emit("Dependency Auditor running (OSV)...")
            dep_findings = await _run_dep_audit(tmpdir)
            await emit(f"Dependency audit complete — {len(dep_findings)} vulnerabilities found")

            # ── Step 3: Layer 2 — LLM reasoning ───────────────────────────────
            await emit("Synthesizing findings with AI...")
            summary = await _llm_summarize(repo_full_name, security_findings, quality_findings, dep_findings)
            await emit("AI synthesis complete")

            # ── Step 4: Health score ───────────────────────────────────────────
            all_findings = security_findings + quality_findings + dep_findings
            health_score, grade = _compute_health_score(all_findings)

            result = {
                "repo": repo_full_name,
                "health_score": health_score,
                "grade": grade,
                "summary": summary,
                "findings": all_findings,
                "counts": {
                    "security": len(security_findings),
                    "quality": len(quality_findings),
                    "dependency": len(dep_findings),
                    "total": len(all_findings),
                },
            }
            scan["result"] = result
            scan["status"] = "complete"
            await emit(
                "Flash audit complete!",
                "done",
                {"health_score": health_score, "grade": grade, "total_findings": len(all_findings)},
            )

    except Exception as e:
        logger.exception("Flash audit %s failed", scan_id)
        scan.update(status="error", error=str(e))
        await queue.put({"type": "error", "message": str(e)})


# ── Static analysis tool runners ───────────────────────────────────────────────


async def _run_bandit(repo_path: str) -> list[dict]:
    """Layer 1 security: run bandit on all Python files."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "bandit", "-r", repo_path, "-f", "json", "-q",
            "--exclude", ".git,node_modules,venv,.venv",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        raw = stdout.decode().strip()
        if not raw:
            return []
        data = json.loads(raw)
        findings = []
        for issue in data.get("results", [])[:30]:
            findings.append({
                "category": "security",
                "severity": issue.get("issue_severity", "MEDIUM").upper(),
                "title": issue.get("test_name", "Security issue").replace("_", " ").title(),
                "file": issue.get("filename", "").replace(repo_path, "").lstrip("/\\"),
                "line": issue.get("line_number", 0),
                "description": issue.get("issue_text", ""),
                "evidence": issue.get("code", "")[:200],
                "cwe": str(issue.get("issue_cwe", {}).get("id", "")),
                "confidence": issue.get("issue_confidence", "MEDIUM"),
                "suggested_fix": "Review and remediate the identified security issue. Consult OWASP guidelines.",
            })
        return findings
    except FileNotFoundError:
        logger.debug("bandit not installed — skipping")
        return []
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception) as e:
        logger.debug("bandit scan error: %s", e)
        return []


async def _run_radon(repo_path: str) -> list[dict]:
    """Layer 1 quality: run radon cyclomatic complexity on Python files."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "radon", "cc", repo_path, "-j", "--min", "C",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        raw = stdout.decode().strip()
        if not raw:
            return []
        data = json.loads(raw)
        findings = []
        for filepath, blocks in data.items():
            rel = filepath.replace(repo_path, "").lstrip("/\\")
            for block in blocks[:5]:
                rank = block.get("rank", "C")
                if rank not in ("C", "D", "E", "F"):
                    continue
                cc = block.get("complexity", 0)
                findings.append({
                    "category": "quality",
                    "severity": "HIGH" if rank in ("E", "F") else "MEDIUM",
                    "title": f"High complexity: {block.get('name', 'unknown')} (rank {rank}, CC={cc})",
                    "file": rel,
                    "line": block.get("lineno", 0),
                    "description": (
                        f"Cyclomatic complexity {cc} (rank {rank}). "
                        "Functions with CC > 10 are hard to test and maintain."
                    ),
                    "suggested_fix": "Break into smaller, single-responsibility functions.",
                })
        return findings[:20]
    except FileNotFoundError:
        logger.debug("radon not installed — skipping")
        return []
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception) as e:
        logger.debug("radon scan error: %s", e)
        return []


async def _run_dep_audit(repo_path: str) -> list[dict]:
    """Layer 1 dependencies: check requirements.txt against OSV API."""
    req_file = Path(repo_path) / "requirements.txt"
    if not req_file.exists():
        return []
    try:
        from backend.agents.dependency_auditor import DependencyAuditorAgent
        agent = DependencyAuditorAgent()
        content = req_file.read_text(errors="ignore")
        packages = agent._parse_requirements_txt(content, "PyPI")
        vulns = await agent._query_osv_batch(packages)
        findings = []
        for vp in vulns[:20]:
            fix = f" Upgrade to {vp.fix_version}." if vp.fix_version else ""
            findings.append({
                "category": "dependency",
                "severity": vp.severity.value,
                "title": f"Vulnerable: {vp.name}@{vp.installed_version}",
                "file": "requirements.txt",
                "line": 0,
                "description": f"{vp.name} {vp.installed_version} — {vp.cve_id}.{fix}",
                "cve": vp.cve_id,
                "suggested_fix": f"Upgrade {vp.name} to {vp.fix_version or 'latest non-vulnerable version'}.",
            })
        return findings
    except Exception as e:
        logger.debug("Dep audit failed: %s", e)
        return []


# ── Layer 2: LLM reasoning ─────────────────────────────────────────────────────


async def _llm_summarize(
    repo_full_name: str,
    security: list[dict],
    quality: list[dict],
    deps: list[dict],
) -> str:
    """Layer 2: LLM generates an executive summary from static analysis signals."""
    if not settings.openai_api_key:
        total = len(security) + len(quality) + len(deps)
        return (
            f"Found {len(security)} security issues, {len(quality)} quality issues, "
            f"and {len(deps)} dependency vulnerabilities ({total} total)."
        )

    sec_lines = "\n".join(
        f"- [{f['severity']}] {f['title']} ({f['file']}:{f['line']})" for f in security[:10]
    ) or "None detected."
    qual_lines = "\n".join(
        f"- [{f['severity']}] {f['title']} ({f['file']}:{f['line']})" for f in quality[:10]
    ) or "None detected."
    dep_lines = "\n".join(
        f"- [{f['severity']}] {f['title']}" for f in deps[:10]
    ) or "None detected."

    prompt = (
        f"Repository: {repo_full_name}\n\n"
        f"SECURITY FINDINGS:\n{sec_lines}\n\n"
        f"CODE QUALITY FINDINGS:\n{qual_lines}\n\n"
        f"DEPENDENCY VULNERABILITIES:\n{dep_lines}\n\n"
        "Write a concise 3-5 sentence executive summary highlighting the most critical issues "
        "and top 2-3 actionable recommendations. Be direct and specific."
    )

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            _executor,
            lambda: client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=350,
            ),
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.warning("LLM summary failed: %s", e)
        total = len(security) + len(quality) + len(deps)
        return (
            f"Detected {len(security)} security issues, {len(quality)} quality issues, "
            f"and {len(deps)} vulnerable dependencies across {repo_full_name}."
        )


# ── Health score ───────────────────────────────────────────────────────────────


def _compute_health_score(findings: list[dict]) -> tuple[int, str]:
    """Compute a 0–100 health score with grade."""
    _PENALTIES = {"CRITICAL": 20, "HIGH": 10, "MEDIUM": 5, "LOW": 2, "INFO": 0}
    score = 100
    for f in findings:
        score -= _PENALTIES.get(f.get("severity", "LOW"), 2)
    score = max(0, min(100, score))

    if score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 60:
        grade = "D"
    else:
        grade = "F"

    return score, grade
