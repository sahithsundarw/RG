"""
Tool Validator — LLM as Quality Gate for static analysis findings.

Pipeline enforced here:
  Scanners (bandit / radon / flake8 / regex)
      ↓
  ToolValidator.validate()
      • extracts ±5 lines of real code context per finding
      • asks LLM: "is this a real issue or a false positive?"
      • discards false positives with ≥ 0.80 LLM confidence
      • may downgrade severity (e.g. HIGH → MEDIUM) for limited-impact findings
      ↓
  Deduplicated, confidence-blended validated findings
      ↓
  Scoring engine (scan.py / health_aggregator.py)

Anti-hallucination guarantee:
  The LLM is NEVER asked to find new issues — only to validate what a tool found.
  It cannot add new findings; it can only accept, reject, or downgrade existing ones.

Fallback:
  When no LLM client is available all findings are passed through unchanged so
  the pipeline degrades gracefully.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=4)

# ── LLM output schema ──────────────────────────────────────────────────────────


class _ValidationResult(BaseModel):
    is_false_positive: bool
    confidence: float = Field(ge=0.0, le=1.0, description="LLM confidence in this verdict")
    reason: str = Field(description="One-sentence explanation of the verdict")
    adjusted_severity: Optional[str] = Field(
        default=None,
        description="Override severity (CRITICAL/HIGH/MEDIUM/LOW) or null to keep original",
    )


class _BatchValidation(BaseModel):
    validations: list[_ValidationResult]


# ── System prompt ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a senior application-security engineer acting as a QUALITY GATE for \
static analysis tool output.

Your job is to validate whether each tool finding is a REAL exploitable issue \
or a FALSE POSITIVE. You must never invent new issues.

FALSE POSITIVE — mark is_false_positive=true when:
  • The "secret" is a variable *name* (e.g. `api_key_param`), not an actual value
  • The finding is in a test / mock / fixture file with obviously fake data
  • The pattern matched a comment, docstring, or string that is not executable
  • The rule is overly broad and this specific usage is demonstrably safe
  • The hardcoded value is a well-known public placeholder (e.g. "localhost", "test123")

REAL ISSUE — mark is_false_positive=false when:
  • A real secret / credential value is hardcoded (not an env-var reference)
  • The injection pattern genuinely applies to this specific code flow
  • An attacker could realistically exploit the code as written

DOWNGRADE severity (adjusted_severity) when the finding is real but impact is \
limited (e.g. SQL injection in an admin-only endpoint with no user input).

Respond with ONLY a valid JSON object matching the schema provided. \
Return exactly one validation per finding, in the same order."""


# ── Main class ─────────────────────────────────────────────────────────────────


class ToolValidator:
    """
    LLM-backed quality gate for static-analysis tool findings.

    Usage::

        validator = ToolValidator(openai_client)
        validated = await validator.validate(raw_findings, repo_path="/tmp/repo")
    """

    # Minimum LLM confidence required to discard a finding as false positive
    _FP_THRESHOLD = 0.80

    def __init__(self, openai_client=None, model: str = "gpt-4o-mini") -> None:
        self._client = openai_client
        self._model = model

    # ── Public API ─────────────────────────────────────────────────────────────

    async def validate(
        self,
        findings: list[dict],
        repo_path: str,
        batch_size: int = 8,
    ) -> list[dict]:
        """
        Validate *findings* against the actual source code in *repo_path*.

        Returns a new list with false positives removed and severities/confidence
        adjusted where the LLM recommends it.  If no LLM client is available the
        input is returned unchanged (graceful degradation).
        """
        if not findings:
            return findings

        if not self._client:
            logger.debug("[tool_validator] No LLM client — passing %d findings through", len(findings))
            return findings

        validated: list[dict] = []
        false_positive_count = 0

        # Process in small batches to stay within token limits
        for i in range(0, len(findings), batch_size):
            batch = findings[i : i + batch_size]
            results = await self._validate_batch(batch, repo_path)

            for finding, result in zip(batch, results):
                if result.is_false_positive and result.confidence >= self._FP_THRESHOLD:
                    false_positive_count += 1
                    logger.debug(
                        "[tool_validator] FP discarded — %s in %s:%s  reason: %s",
                        finding.get("title", ""),
                        finding.get("file", ""),
                        finding.get("line", ""),
                        result.reason,
                    )
                    continue

                # Apply severity downgrade if LLM recommended it
                updated = dict(finding)
                if result.adjusted_severity and result.adjusted_severity.upper() in (
                    "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
                ):
                    updated["severity"] = result.adjusted_severity.upper()

                # Blend original tool confidence with LLM validation confidence
                orig = finding.get("confidence", 0.7)
                if isinstance(orig, str):
                    orig = {"HIGH": 0.90, "MEDIUM": 0.65, "LOW": 0.30}.get(orig.upper(), 0.65)
                updated["confidence"] = round((float(orig) + result.confidence) / 2, 3)
                updated["llm_validated"] = True
                validated.append(updated)

        if false_positive_count:
            logger.info(
                "[tool_validator] Filtered %d/%d findings as false positives",
                false_positive_count,
                len(findings),
            )

        return validated

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _extract_code_context(
        self,
        file_path: str,
        line_num: int,
        repo_path: str,
        window: int = 5,
    ) -> str:
        """Return *window* lines before and after *line_num* with line-number annotations."""
        if not file_path or not line_num:
            return ""
        try:
            full = Path(repo_path) / file_path
            if not full.exists():
                # Try treating file_path as absolute
                full = Path(file_path)
            if not full.exists():
                return ""
            lines = full.read_text(errors="ignore").splitlines()
            start = max(0, line_num - 1 - window)
            end = min(len(lines), line_num + window)
            out = []
            for i, ln in enumerate(lines[start:end], start=start + 1):
                marker = ">>>" if i == line_num else "   "
                out.append(f"{i:5d} {marker} {ln}")
            return "\n".join(out)
        except Exception as exc:
            logger.debug("[tool_validator] Context extraction failed for %s:%s — %s", file_path, line_num, exc)
            return ""

    def _build_prompt(self, findings: list[dict], repo_path: str) -> str:
        """Construct the LLM validation prompt for a batch of findings."""
        schema_json = json.dumps(_BatchValidation.model_json_schema(), indent=2)
        header = (
            f"Validate the following {len(findings)} static analysis findings.\n"
            f"Return a JSON object with a 'validations' array of exactly "
            f"{len(findings)} items (one per finding, same order).\n\n"
            f"Schema:\n{schema_json}\n\n"
        )

        blocks: list[str] = []
        for idx, f in enumerate(findings, 1):
            code_ctx = self._extract_code_context(
                f.get("file", ""), f.get("line", 0), repo_path
            )
            block_lines = [
                f"=== Finding #{idx} ===",
                f"Tool rule : {f.get('title', 'unknown')}",
                f"File      : {f.get('file', '')}  line {f.get('line', '?')}",
                f"Severity  : {f.get('severity', 'MEDIUM')}  "
                f"Confidence: {f.get('confidence', '?')}",
                f"Message   : {f.get('description', '')}",
            ]
            if f.get("evidence"):
                block_lines.append(f"Evidence  : {f['evidence'][:200]}")
            if code_ctx:
                block_lines.append(f"Code context:\n{code_ctx}")
            blocks.append("\n".join(block_lines))

        return header + "\n\n".join(blocks)

    async def _validate_batch(
        self, findings: list[dict], repo_path: str
    ) -> list[_ValidationResult]:
        """Call the LLM to validate one batch; return per-finding verdicts."""
        prompt = self._build_prompt(findings, repo_path)
        system = _SYSTEM_PROMPT

        fallback = [
            _ValidationResult(is_false_positive=False, confidence=0.70, reason="validation unavailable")
            for _ in findings
        ]

        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _executor,
                lambda: self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=1200,
                    temperature=0.0,  # deterministic for quality-gate decisions
                ),
            )

            content = response.choices[0].message.content.strip()
            # Strip markdown fences if model wraps response
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(
                    lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
                )

            result = _BatchValidation.model_validate_json(content)

            # Pad in case LLM returned fewer items than expected
            while len(result.validations) < len(findings):
                result.validations.append(
                    _ValidationResult(is_false_positive=False, confidence=0.70, reason="no verdict")
                )
            return result.validations[: len(findings)]

        except Exception as exc:
            logger.warning("[tool_validator] Batch validation failed (%s) — passing findings through", exc)
            return fallback


# ── Standalone deduplication helper ───────────────────────────────────────────


def deduplicate_findings(findings: list[dict], line_proximity: int = 4) -> list[dict]:
    """
    Merge findings that refer to the same code location across tools/agents.

    Two findings are considered duplicates when:
      • same file path  AND
      • |line_a - line_b| ≤ line_proximity  AND
      • same broad category (SECURITY / CODE_SMELL / DEPENDENCY)

    The merged finding keeps the highest severity, combines the titles, and sets
    multi_agent_agreement=True so the UI can surface the "confirmed by multiple
    tools" badge.
    """
    if not findings:
        return findings

    _SEV_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}

    groups: list[list[dict]] = []

    def _same_group(a: dict, b: dict) -> bool:
        if a.get("file") != b.get("file") or not a.get("file"):
            return False
        if a.get("category") != b.get("category"):
            return False
        la = int(a.get("line") or 0)
        lb = int(b.get("line") or 0)
        return abs(la - lb) <= line_proximity

    for f in findings:
        placed = False
        for g in groups:
            if _same_group(g[0], f):
                g.append(f)
                placed = True
                break
        if not placed:
            groups.append([f])

    merged: list[dict] = []
    for group in groups:
        if len(group) == 1:
            merged.append(group[0])
            continue

        # Pick the member with the highest severity as the base
        base = min(group, key=lambda x: _SEV_RANK.get(x.get("severity", "MEDIUM"), 2))
        sources = list({f.get("agent_source", "unknown") for f in group})

        consolidated = dict(base)
        consolidated["multi_agent_agreement"] = True
        consolidated["agent_source"] = ", ".join(sorted(sources))

        # Merge descriptions if they differ
        descs = list({f.get("description", "") for f in group if f.get("description")})
        if len(descs) > 1:
            consolidated["description"] = base.get("description", "") + " [Confirmed by multiple tools]"

        # Best suggested_fix wins (longest, usually most detailed)
        fixes = [f.get("suggested_fix", "") for f in group if f.get("suggested_fix")]
        if fixes:
            consolidated["suggested_fix"] = max(fixes, key=len)

        # Highest confidence wins
        confs = [
            float(f["confidence"]) if isinstance(f.get("confidence"), (int, float))
            else {"HIGH": 0.9, "MEDIUM": 0.65, "LOW": 0.3}.get(str(f.get("confidence", "MEDIUM")).upper(), 0.65)
            for f in group
        ]
        consolidated["confidence"] = round(max(confs), 3)

        logger.debug(
            "[dedup] Merged %d findings at %s:%s → %s",
            len(group), base.get("file"), base.get("line"), base.get("title"),
        )
        merged.append(consolidated)

    return merged
