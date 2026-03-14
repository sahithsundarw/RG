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

import backend.services.storage as storage
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
    scan_path: str = ""   # optional sub-directory to analyse (e.g. "backend")


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
    background_tasks.add_task(_run_flash_audit, scan_id, body.repo_url, queue, body.scan_path or "")
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
    r = scan["result"] or {}
    return {
        "status": "complete",
        "repo_id": r.get("repo_id"),
        "health_score": r.get("health_score"),
        "grade": r.get("grade"),
        "total_findings": r.get("counts", {}).get("total"),
        "summary": r.get("summary"),
    }


# ── Public entry point for webhook-triggered audits ───────────────────────────


async def run_audit_for_repo(repo_url: str, scan_path: str = "") -> dict | None:
    """Run a flash audit without SSE — called directly when Redis is unavailable.

    Args:
        repo_url:  The repository clone URL.
        scan_path: Optional sub-directory to scope analysis (e.g. ``"backend"``).
                   Empty string means the entire repository.

    Returns the result dict (with repo_id) or None on failure.
    """
    try:
        owner_name = _parse_github_url(repo_url)  # raises if unparseable
        repo_full_name = f"{owner_name[0]}/{owner_name[1]}"
    except ValueError as e:
        logger.warning("[webhook_audit] Cannot parse URL %r: %s", repo_url, e)
        return None

    scan_label = f"{repo_full_name}/{scan_path}" if scan_path else repo_full_name
    logger.info("[webhook_audit] Starting direct flash audit for %s", scan_label)

    with tempfile.TemporaryDirectory() as tmpdir:
        clone_url = f"https://github.com/{repo_full_name}.git"
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", clone_url, tmpdir,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            logger.error("[webhook_audit] Clone timed out for %s", repo_full_name)
            return None

        if proc.returncode != 0:
            logger.error("[webhook_audit] Clone failed for %s: %s", repo_full_name, stderr.decode()[:200])
            return None

        # Resolve scan root — sub-directory when scan_path is provided
        scan_root = str(Path(tmpdir) / scan_path) if scan_path else tmpdir
        if scan_path and not Path(scan_root).is_dir():
            logger.warning("[webhook_audit] scan_path %r not found in %s — falling back to repo root", scan_path, repo_full_name)
            scan_root = tmpdir

        security_findings = await _run_bandit(scan_root)
        quality_findings = await _run_radon(scan_root)
        dep_findings = await _run_dep_audit(scan_root)
        summary = await _llm_summarize(scan_label, security_findings, quality_findings, dep_findings, scan_root)

        all_findings = security_findings + quality_findings + dep_findings
        health_score, grade = _compute_health_score(all_findings)

        repo_id = _persist_scan_results(
            repo_full_name=repo_full_name,
            clone_url=repo_url,
            health_score=health_score,
            grade=grade,
            findings=all_findings,
            summary=summary,
            scan_path=scan_path,
        )

        logger.info(
            "[webhook_audit] Completed for %s — score=%d grade=%s findings=%d repo_id=%s",
            scan_label, health_score, grade, len(all_findings), repo_id,
        )
        return {"repo_id": repo_id, "health_score": health_score, "grade": grade, "total_findings": len(all_findings)}


# ── Flash Audit Pipeline ───────────────────────────────────────────────────────


def _parse_github_url(url: str) -> tuple[str, str]:
    m = re.search(r"github\.com[:/]([^/]+)/([^/\s\.]+?)(?:\.git)?$", url)
    if not m:
        raise ValueError(f"Cannot parse GitHub URL: {url!r}. Expected https://github.com/owner/repo")
    return m.group(1), m.group(2)


async def _run_flash_audit(scan_id: str, repo_url: str, queue: asyncio.Queue, scan_path: str = "") -> None:
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
        scan_label = f"{repo_full_name}/{scan_path}" if scan_path else repo_full_name
        await emit(f"Starting flash audit for {scan_label}")

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

            # Resolve the scan root — sub-directory if scan_path is set
            scan_root = str(Path(tmpdir) / scan_path) if scan_path else tmpdir

            if scan_path:
                await emit(f"Repository cloned. Scanning project: {scan_path}/")
            else:
                await emit("Repository cloned. Running static analysis...")

            # ── Step 2: Layer 1 — Static analysis tools ────────────────────────
            await emit("Security Scan Agent running (bandit + AST)...")
            security_findings = await _run_bandit(scan_root)
            ast_security = await _run_ast_security_scan(scan_root)
            # Merge: AST findings first (higher precision), then bandit
            security_findings = ast_security + [
                f for f in security_findings
                if not any(
                    abs((f.get("line") or 0) - (a.get("line") or 0)) < 3 and f.get("file") == a.get("file")
                    for a in ast_security
                )
            ]
            await emit(f"Security scan complete — {len(security_findings)} issues found")

            await emit("Code Quality Agent running (radon + complexity)...")
            quality_findings = await _run_radon(scan_root)
            await emit(f"Code quality analysis complete — {len(quality_findings)} issues found")

            await emit("Dependency Auditor running (OSV + registry)...")
            dep_findings = await _run_dep_audit(scan_root)
            await emit(f"Dependency audit complete — {len(dep_findings)} issues found")

            # ── Step 3: Layer 2 — LLM reasoning ───────────────────────────────
            await emit("AI Agent synthesizing findings...")
            summary = await _llm_summarize(scan_label, security_findings, quality_findings, dep_findings, scan_root)
            await emit("AI synthesis complete")

            # ── Step 4: Health score ───────────────────────────────────────────
            all_findings = security_findings + quality_findings + dep_findings
            health_score, grade = _compute_health_score(all_findings)

            # ── Step 5: Persist to storage so dashboard can display results ────
            repo_id = _persist_scan_results(
                repo_full_name=repo_full_name,
                clone_url=repo_url,
                health_score=health_score,
                grade=grade,
                findings=all_findings,
                summary=summary,
                scan_path=scan_path,
            )

            result = {
                "repo": repo_full_name,
                "repo_id": repo_id,
                "health_score": health_score,
                "grade": grade,
                "summary": summary,
                "findings": all_findings,
                "scan_path": scan_path,
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
                {"health_score": health_score, "grade": grade, "total_findings": len(all_findings), "repo_id": repo_id},
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
                "category": "SECURITY",
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


async def _run_ast_security_scan(repo_path: str) -> list[dict]:
    """AST-based Python security analysis — catches issues bandit may miss."""
    import ast as ast_module
    findings = []
    repo = Path(repo_path)

    # Find Python files (skip venv/node_modules)
    py_files = [
        p for p in repo.rglob("*.py")
        if not any(skip in str(p) for skip in ("venv", ".venv", "node_modules", ".git", "__pycache__", "dist"))
    ][:40]  # Cap at 40 files

    for py_file in py_files:
        try:
            source = py_file.read_text(errors="ignore")
            tree = ast_module.parse(source, filename=str(py_file))
        except SyntaxError:
            continue

        rel_path = str(py_file).replace(repo_path, "").lstrip("/\\")

        for node in ast_module.walk(tree):
            # Detect f-string SQL injection: cursor.execute(f"...{var}...")
            if isinstance(node, ast_module.Call):
                func_name = _ast_func_name(node)
                if func_name and any(x in func_name.lower() for x in ("execute", "query", "raw")):
                    if node.args and isinstance(node.args[0], ast_module.JoinedStr):
                        findings.append({
                            "category": "SECURITY",
                            "severity": "CRITICAL",
                            "title": "SQL injection via f-string",
                            "file": rel_path,
                            "line": node.lineno,
                            "description": "Database query built with an f-string containing variables — attacker-controlled input can manipulate the query.",
                            "evidence": ast_module.unparse(node)[:200],
                            "suggested_fix": "Use parameterized queries: cursor.execute('SELECT * FROM t WHERE id = %s', (user_id,))",
                            "cwe": "CWE-89",
                            "confidence": "HIGH",
                        })

                # Detect subprocess with shell=True and variable input
                if func_name and "subprocess" in func_name:
                    keywords = {kw.arg: kw for kw in node.keywords}
                    shell_kw = keywords.get("shell")
                    if shell_kw and isinstance(shell_kw.value, ast_module.Constant) and shell_kw.value.value is True:
                        # Check if first arg is not a plain string literal
                        if node.args and not isinstance(node.args[0], ast_module.Constant):
                            findings.append({
                                "category": "SECURITY",
                                "severity": "HIGH",
                                "title": "Command injection via subprocess shell=True",
                                "file": rel_path,
                                "line": node.lineno,
                                "description": "subprocess called with shell=True and a non-literal command string. An attacker may inject shell commands.",
                                "evidence": ast_module.unparse(node)[:200],
                                "suggested_fix": "Pass command as a list (no shell=True): subprocess.run(['cmd', arg1, arg2])",
                                "cwe": "CWE-78",
                                "confidence": "HIGH",
                            })

                # Detect eval/exec with any non-constant argument
                if isinstance(node.func, ast_module.Name) and node.func.id in ("eval", "exec"):
                    if node.args and not isinstance(node.args[0], ast_module.Constant):
                        findings.append({
                            "category": "SECURITY",
                            "severity": "CRITICAL",
                            "title": f"Arbitrary code execution via {node.func.id}()",
                            "file": rel_path,
                            "line": node.lineno,
                            "description": f"{node.func.id}() called with a non-literal argument allows arbitrary code execution.",
                            "evidence": ast_module.unparse(node)[:200],
                            "suggested_fix": "Use ast.literal_eval() for safe value parsing, or refactor to avoid eval entirely.",
                            "cwe": "CWE-94",
                            "confidence": "HIGH",
                        })

            # Detect assert used for security checks (stripped in -O mode)
            if isinstance(node, ast_module.Assert):
                src_line = source.splitlines()[node.lineno - 1].strip() if node.lineno <= len(source.splitlines()) else ""
                if any(x in src_line.lower() for x in ("auth", "permission", "admin", "role", "login")):
                    findings.append({
                        "category": "SECURITY",
                        "severity": "HIGH",
                        "title": "Security check via assert (disabled in optimised mode)",
                        "file": rel_path,
                        "line": node.lineno,
                        "description": "assert statements are removed when Python runs with -O flag. Do not use assert for security checks.",
                        "evidence": src_line[:150],
                        "suggested_fix": "Replace with an explicit if/raise: if not condition: raise PermissionError(...)",
                        "cwe": "CWE-617",
                        "confidence": "HIGH",
                    })

    return findings[:25]


def _ast_func_name(node) -> str | None:
    """Extract string name from an AST Call node's func attribute."""
    import ast as ast_module
    func = node.func
    if isinstance(func, ast_module.Name):
        return func.id
    elif isinstance(func, ast_module.Attribute):
        base = _ast_func_name_simple(func.value)
        return f"{base}.{func.attr}" if base else func.attr
    return None


def _ast_func_name_simple(node) -> str | None:
    import ast as ast_module
    if isinstance(node, ast_module.Name):
        return node.id
    elif isinstance(node, ast_module.Attribute):
        return node.attr
    return None


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
                    "category": "CODE_SMELL",
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
    """Layer 1 dependencies: check all package manifests against OSV API."""
    _MANIFEST_PARSERS = {
        "requirements.txt":     ("PyPI",      "_parse_requirements_txt"),
        "requirements-dev.txt": ("PyPI",      "_parse_requirements_txt"),
        "pyproject.toml":       ("PyPI",      "_parse_pyproject_toml"),
        "Pipfile":              ("PyPI",      "_parse_requirements_txt"),
        "package.json":         ("npm",       "_parse_package_json"),
        "go.mod":               ("Go",        "_parse_go_mod"),
        "Cargo.toml":           ("crates.io", "_parse_cargo_toml"),
    }
    try:
        from backend.agents.dependency_auditor import DependencyAuditorAgent
        agent = DependencyAuditorAgent()
        all_findings: list[dict] = []
        seen_packages: set[str] = set()

        for filename, (ecosystem, parser_method) in _MANIFEST_PARSERS.items():
            manifest = Path(repo_path) / filename
            if not manifest.exists():
                continue
            content = manifest.read_text(errors="ignore")
            parse_fn = getattr(agent, parser_method)
            packages = parse_fn(content, ecosystem)
            vulns = await agent._query_osv_batch(packages)
            outdated, license_issues = await agent._check_registry_metadata(packages)

            for vp in vulns[:15]:
                key = f"{vp.name}@{vp.installed_version}"
                if key in seen_packages:
                    continue
                seen_packages.add(key)
                fix = f" Upgrade to {vp.fix_version}." if vp.fix_version else ""
                all_findings.append({
                    "category": "DEPENDENCY",
                    "severity": vp.severity.value,
                    "title": f"Vulnerable: {vp.name}@{vp.installed_version}",
                    "file": filename,
                    "line": 0,
                    "description": f"{vp.name} {vp.installed_version} has known vulnerability {vp.cve_id}.{fix}",
                    "cve": vp.cve_id,
                    "suggested_fix": f"Upgrade {vp.name} to {vp.fix_version or 'latest non-vulnerable version'}.",
                })

            for pkg in outdated[:5]:
                key = f"{pkg['name']}@{pkg['installed_version']}-outdated"
                if key in seen_packages:
                    continue
                seen_packages.add(key)
                all_findings.append({
                    "category": "DEPENDENCY",
                    "severity": "LOW",
                    "title": f"Outdated: {pkg['name']} ({pkg['installed_version']} → {pkg['latest_version']})",
                    "file": filename,
                    "line": 0,
                    "description": f"{pkg['name']} is behind: {pkg['installed_version']} installed, {pkg['latest_version']} available.",
                    "suggested_fix": f"Run: pip install --upgrade {pkg['name']} (or npm update {pkg['name']})",
                })

            for pkg in license_issues[:3]:
                all_findings.append({
                    "category": "DEPENDENCY",
                    "severity": "MEDIUM",
                    "title": f"Copyleft license: {pkg['name']} ({pkg['license']})",
                    "file": filename,
                    "line": 0,
                    "description": f"{pkg['name']} uses {pkg['license']} which may require open-sourcing your code.",
                    "suggested_fix": f"Review {pkg['license']} compatibility. Consider an MIT/Apache alternative.",
                })

        return all_findings[:30]
    except Exception as e:
        logger.debug("Dep audit failed: %s", e)
        return []


# ── Layer 2: LLM reasoning ─────────────────────────────────────────────────────


async def _llm_summarize(
    repo_full_name: str,
    security: list[dict],
    quality: list[dict],
    deps: list[dict],
    repo_path: str = "",
) -> str:
    """Layer 2: LLM generates an actionable summary with code evidence."""
    total = len(security) + len(quality) + len(deps)
    if not settings.openai_api_key:
        sev_counts: dict[str, int] = {}
        for f in security + quality + deps:
            sev_counts[f.get("severity", "MEDIUM")] = sev_counts.get(f.get("severity", "MEDIUM"), 0) + 1
        parts = [f"{v} {k}" for k, v in sorted(sev_counts.items())]
        return (
            f"Found {total} issues: {', '.join(parts)}. "
            f"Top concern: {(security + quality + deps)[0]['title'] if (security + quality + deps) else 'none'}."
        )

    # Build rich prompt with code evidence for top findings
    def _finding_block(f: dict, idx: int) -> str:
        lines = [f"{idx}. [{f['severity']}] {f['title']}"]
        if f.get("file"):
            lines.append(f"   File: {f['file']}:{f.get('line', 0)}")
        if f.get("description"):
            lines.append(f"   Issue: {f['description'][:200]}")
        if f.get("evidence"):
            lines.append(f"   Code: {f['evidence'][:150]}")
        if f.get("suggested_fix"):
            lines.append(f"   Fix: {f['suggested_fix'][:150]}")
        return "\n".join(lines)

    # Prioritise: CRITICAL > HIGH > MEDIUM, take top 8 total
    all_findings = sorted(
        security + quality + deps,
        key=lambda f: {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}.get(f.get("severity", "MEDIUM"), 2)
    )
    top_findings = all_findings[:8]

    findings_text = "\n\n".join(_finding_block(f, i + 1) for i, f in enumerate(top_findings))

    prompt = f"""Repository: {repo_full_name}
Total issues found: {total} ({len(security)} security, {len(quality)} code quality, {len(deps)} dependency)

TOP FINDINGS WITH CODE EVIDENCE:
{findings_text}

Based on these specific findings with code evidence, write a 4-6 sentence technical summary that:
1. Names the most critical specific vulnerability found (with file/line if available)
2. Identifies the primary code quality concern with the affected function
3. Lists the most urgent dependency to upgrade (with CVE if available)
4. Gives 2-3 concrete, actionable steps the developer should take first

Be direct and technical. Reference specific files, function names, and CVE IDs from the findings above."""

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            _executor,
            lambda: client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
            ),
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.warning("LLM summary failed: %s", e)
        top = all_findings[0] if all_findings else None
        return (
            f"Found {total} issues across {repo_full_name}. "
            + (f"Most critical: {top['title']} in {top.get('file', 'unknown')}. " if top else "")
            + f"{len(security)} security, {len(quality)} quality, {len(deps)} dependency issues."
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
    elif score >= 75:
        grade = "B"
    elif score >= 60:
        grade = "C"
    elif score >= 40:
        grade = "D"
    else:
        grade = "F"

    return score, grade


# ── Persist scan results to storage ───────────────────────────────────────────


def _persist_scan_results(
    repo_full_name: str,
    clone_url: str,
    health_score: int,
    grade: str,
    findings: list[dict],
    summary: str,
    scan_path: str = "",
) -> str:
    """Save flash-audit results to in-memory storage so the dashboard can read them.

    Returns the repo_id (existing or newly created).
    """
    from datetime import datetime, timezone
    import uuid as _uuid

    # Determine platform from URL
    if "gitlab.com" in clone_url:
        platform = "gitlab"
    elif "bitbucket.org" in clone_url:
        platform = "bitbucket"
    else:
        platform = "github"

    # Register repo if not already present
    existing = storage.get_repo_by_full_name(repo_full_name)
    if existing:
        repo_id = existing["id"]
    else:
        repo_id = str(_uuid.uuid4())
        now = datetime.now(timezone.utc)
        parts = repo_full_name.split("/", 1)
        storage.save_repo(repo_id, {
            "id": repo_id,
            "platform": platform,
            "owner": parts[0],
            "name": parts[1] if len(parts) > 1 else parts[0],
            "full_name": repo_full_name,
            "clone_url": clone_url,
            "default_branch": "main",
            "primary_language": None,
            "is_active": True,
            "config": {},
            "created_at": now,
            "updated_at": now,
        })

    now = datetime.now(timezone.utc)

    # Auto-resolve all previously open findings for this repo so each scan
    # produces a fresh health score rather than accumulating stale findings.
    old_findings = storage.list_findings(repo_id=repo_id, status="open", limit=10000)
    for old_f in old_findings:
        storage.update_finding(old_f["id"], {
            "status": "auto_resolved",
            "resolved_at": now.isoformat(),
        })
    if old_findings:
        logger.info("[scan] Auto-resolved %d stale findings for repo %s before new scan", len(old_findings), repo_id)

    # Save individual findings
    sev_map = {"CRITICAL": "CRITICAL", "HIGH": "HIGH", "MEDIUM": "MEDIUM", "LOW": "LOW", "INFO": "INFO"}
    for f in findings:
        finding_id = str(_uuid.uuid4())
        storage.save_finding(finding_id, {
            "id": finding_id,
            "repository_id": repo_id,
            "file_path": f.get("file") or None,
            "line_start": f.get("line") or None,
            "line_end": None,
            "category": f.get("category", "SECURITY"),
            "severity": sev_map.get(f.get("severity", "MEDIUM"), "MEDIUM"),
            "title": f.get("title", "Finding"),
            "description": f.get("description", ""),
            "evidence": f.get("evidence") or None,
            "suggested_fix": f.get("suggested_fix") or None,
            "reasoning": None,
            "cwe_id": f.get("cwe") or None,
            "confidence": 0.8,
            "agent_source": "flash_audit",
            "status": "open",
            "pr_number": None,
            "created_at": now.isoformat(),
            "resolved_at": None,
            "is_suppressed": False,
        })

    # Compute sub-scores from findings
    sev_penalties = {"CRITICAL": 20, "HIGH": 10, "MEDIUM": 5, "LOW": 2, "INFO": 0}
    sub = {"code_quality": 100.0, "security": 100.0, "dependencies": 100.0, "documentation": 100.0, "test_coverage": 100.0}
    cat_to_sub = {"SECURITY": "security", "DEPENDENCY": "dependencies", "CODE_SMELL": "code_quality", "BUG": "code_quality"}
    for f in findings:
        cat = f.get("category", "quality")
        sub_key = cat_to_sub.get(cat, "code_quality")
        sub[sub_key] = max(0.0, sub[sub_key] - sev_penalties.get(f.get("severity", "MEDIUM"), 5))

    # Save health record
    storage.save_health_record({
        "id": str(_uuid.uuid4()),
        "repository_id": repo_id,
        "timestamp": now,
        "overall_score": float(health_score),
        "grade": grade,
        "score_code_quality": sub["code_quality"],
        "score_security": sub["security"],
        "score_dependencies": sub["dependencies"],
        "score_documentation": sub["documentation"],
        "score_test_coverage": sub["test_coverage"],
        "critical_count": sum(1 for f in findings if f.get("severity") == "CRITICAL"),
        "high_count": sum(1 for f in findings if f.get("severity") == "HIGH"),
        "medium_count": sum(1 for f in findings if f.get("severity") == "MEDIUM"),
        "low_count": sum(1 for f in findings if f.get("severity") == "LOW"),
        "info_count": sum(1 for f in findings if f.get("severity") == "INFO"),
        "trigger_event": "flash_audit",
        "trigger_pr_number": None,
        "metadata": {"verdict": "flash_audit", "token_cost": 0, "files_reviewed": 0, "summary": summary, "scan_path": scan_path},
    })

    # Save audit log entry
    storage.save_audit_log({
        "id": str(_uuid.uuid4()),
        "repository_id": repo_id,
        "timestamp": now,
        "event_type": "flash_audit",
        "actor": "RepoGuardian",
        "metadata": {"health_score": health_score, "grade": grade, "total_findings": len(findings), "scan_path": scan_path},
    })

    logger.info("[scan] Persisted %d findings for repo %s (id=%s)", len(findings), repo_full_name, repo_id)
    return repo_id
