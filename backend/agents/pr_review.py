"""
PR Review Agent.

Performs a deep, senior-engineer-quality code review of the PR diff.
Detects bugs, logic errors, performance issues, and style problems.
Produces structured ReviewResult with per-finding evidence and suggested fixes.

Evidence-anchoring rule:
  Every finding MUST cite specific code from the context package.
  Findings without a direct code quote are rejected in post-processing.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field
from typing import List, Optional

from backend.agents.base import BaseAgent
from backend.config import get_settings
from backend.models.database import FindingCategory, Severity
from backend.models.schemas import AgentFinding, ContextPackage, PRReviewResult

logger = logging.getLogger(__name__)
settings = get_settings()

_executor = ThreadPoolExecutor(max_workers=4)


# ── System prompt ──────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a senior software engineer performing a thorough code review.
Your role is to analyse the provided pull request diff and identify genuine issues.

CRITICAL RULES:
1. Only flag issues where you can quote the EXACT problematic code from the context provided.
2. Do NOT infer behaviour from code you cannot see. If uncertain, say so in the reasoning.
3. Do NOT flag stylistic preferences as bugs. Focus on correctness, security, and meaningful quality issues.
4. Every finding MUST have a concrete `evidence` field quoting the problematic lines.
5. Every finding MUST have a `suggested_fix` with working, specific code — not vague advice.
6. Assign confidence scores honestly: 0.9+ only when the issue is unambiguous.

Severity guidelines:
  CRITICAL: Crashes, data loss, auth bypass, major security vulnerability
  HIGH:     Significant bugs, security risks, major performance issues
  MEDIUM:   Correctness issues, moderate code smells, missing error handling
  LOW:      Minor style/readability, minor inefficiencies
  INFO:     Observations, positive notes, optional improvements

Categories:
  BUG:         Logic errors, null dereferences, off-by-one, race conditions
  SECURITY:    Input validation, auth, injection — prefer SecurityScannerAgent for these
  PERFORMANCE: Algorithmic inefficiency, unnecessary DB calls, memory leaks
  STYLE:       Naming, structure, readability
  LOGIC:       Incorrect algorithm, wrong operator, semantic error
  CODE_SMELL:  Duplication, long method, god class, dead code
"""


class PRReviewAgent(BaseAgent):
    """
    Analyses the PR diff for bugs, logic errors, performance issues,
    and code quality problems.
    """

    name = "pr_review"

    async def run(self, context: ContextPackage) -> PRReviewResult:
        """
        Perform the full PR review analysis.

        Returns a PRReviewResult with structured findings.
        """
        self.log_info("Starting PR review for %s PR#%s",
                      context.repo_full_name, context.pr_number)

        user_message = self._build_prompt(context)

        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                _executor,
                lambda: self.call_llm(
                    system_prompt=_SYSTEM_PROMPT,
                    user_message=user_message,
                    output_schema=_PRReviewLLMOutput,
                ),
            )
        except Exception as e:
            self.log_error("PR review LLM call failed: %s", e=str(e))
            return self._empty_result()

        # Convert LLM output to final schema, attach agent_source
        findings = [
            AgentFinding(
                agent_source=self.name,
                file_path=f.file_path,
                line_start=f.line_start,
                line_end=f.line_end,
                category=_parse_category(f.category),
                severity=_parse_severity(f.severity),
                title=f.title,
                description=f.description,
                evidence=f.evidence,
                suggested_fix=f.suggested_fix,
                reasoning=f.reasoning,
                confidence=f.confidence,
            )
            for f in result.findings
        ]

        # Evidence-anchoring filter: drop findings with no evidence quote
        findings = [f for f in findings if f.evidence and len(f.evidence.strip()) > 5]

        # Confidence threshold filter
        findings = self.apply_confidence_threshold(findings)

        pr_result = PRReviewResult(
            agent_source=self.name,
            summary=result.summary,
            overall_verdict=result.overall_verdict,
            findings=findings,
            positive_observations=result.positive_observations,
            test_coverage_assessment=result.test_coverage_assessment,
            architectural_concerns=result.architectural_concerns,
            total_token_cost=self.total_token_cost,
        )

        self.log_info("PR review complete: %d findings (after filtering)", len(findings))
        return pr_result

    def _build_prompt(self, context: ContextPackage) -> str:
        """Construct the full analysis prompt from the context package."""
        sections = [
            f"## Pull Request: {context.pr_title or 'Untitled'}",
            f"**Repository:** {context.repo_full_name}",
            f"**Author:** {context.pr_author or 'unknown'}",
            f"**Files changed:** {', '.join(context.changed_files[:8])}",
        ]

        if context.pr_description:
            sections.append(f"\n**Description:**\n{context.pr_description[:500]}")

        # Add line numbers to diff so LLM can reference exact lines
        diff_lines = context.raw_diff.split("\n")
        numbered = []
        line_num = 0
        for line in diff_lines:
            if line.startswith("@@"):
                # Parse hunk header to get starting line number
                import re as _re
                m = _re.search(r"\+(\d+)", line)
                if m:
                    line_num = int(m.group(1)) - 1
                numbered.append(line)
            elif line.startswith("+") and not line.startswith("+++"):
                line_num += 1
                numbered.append(f"{line_num:4d} | {line}")
            elif line.startswith("-") and not line.startswith("---"):
                numbered.append(f"     | {line}")
            else:
                if not line.startswith(("+++", "---")):
                    line_num += 1
                numbered.append(line)
        sections.append("\n## Diff (line numbers on added lines)\n```diff\n" + "\n".join(numbered) + "\n```")

        if context.expanded_definitions:
            defs_text = "\n\n".join(
                f"### {name}\n```\n{src}\n```"
                for name, src in list(context.expanded_definitions.items())[:8]
            )
            sections.append(f"\n## Full Symbol Definitions (for context)\n{defs_text}")

        if context.callers:
            callers_text = "\n".join(
                f"- `{sym}` is called by: {', '.join(callers[:3])}"
                for sym, callers in list(context.callers.items())[:5]
                if callers
            )
            if callers_text:
                sections.append(f"\n## Call Context (who calls the changed functions)\n{callers_text}")

        if context.relevant_test_files:
            test_texts = "\n\n".join(
                f"### {tf.path}\n```\n{tf.content[:1500]}\n```"
                for tf in context.relevant_test_files[:2]
            )
            sections.append(f"\n## Existing Tests (check for gaps)\n{test_texts}")

        if context.semantic_neighbors:
            neighbors_text = "\n\n".join(
                f"### Similar code: {n.file_path}:{n.start_line} (similarity {n.similarity_score:.2f})\n```\n{n.source[:400]}\n```"
                for n in context.semantic_neighbors[:2]
            )
            sections.append(f"\n## Similar Code Patterns (duplication check)\n{neighbors_text}")

        sections.append("""
## Analysis Instructions

Analyse the diff for these issue types (check ALL of them):
1. **BUG**: Logic errors, null/undefined access, off-by-one, race conditions, wrong operator
2. **PERFORMANCE**: N+1 queries, loops inside loops, unnecessary re-computation, missing memoisation
3. **SECURITY**: Unvalidated input, injection risks, auth bypass, insecure defaults
4. **CODE_SMELL**: Functions >40 lines, duplicate blocks (>5 lines), deep nesting (>4 levels)
5. **TEST_GAP**: New code paths with no corresponding test

For each finding you MUST provide:
- The EXACT line number from the numbered diff above
- A quoted code snippet (evidence field)
- A concrete fix with working code
- Honest confidence (0.9+ only for unambiguous issues)

Do NOT flag: import ordering, minor naming preferences, or issues you cannot see in the diff.
""")

        return "\n".join(sections)

    def _empty_result(self) -> PRReviewResult:
        return PRReviewResult(
            agent_source=self.name,
            summary="PR review failed due to an internal error.",
            overall_verdict="NEEDS_DISCUSSION",
            findings=[],
            positive_observations=[],
            test_coverage_assessment="Unable to assess.",
            architectural_concerns="",
        )


# ── LLM output schema (intermediate, before conversion to canonical AgentFinding) ──


class _FindingLLM(BaseModel):
    file_path: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    category: str  # "BUG" | "PERFORMANCE" | "STYLE" | "LOGIC" | "CODE_SMELL"
    severity: str  # "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"
    title: str
    description: str
    evidence: Optional[str] = None   # REQUIRED: quoted code
    suggested_fix: Optional[str] = None
    reasoning: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


class _PRReviewLLMOutput(BaseModel):
    summary: str
    overall_verdict: str = "NEEDS_DISCUSSION"  # "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION"
    findings: List[_FindingLLM] = []
    positive_observations: List[str] = []
    test_coverage_assessment: str = ""
    architectural_concerns: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────


def _parse_severity(raw: str) -> Severity:
    mapping = {
        "CRITICAL": Severity.CRITICAL, "HIGH": Severity.HIGH,
        "MEDIUM": Severity.MEDIUM, "LOW": Severity.LOW, "INFO": Severity.INFO,
    }
    return mapping.get(raw.upper(), Severity.MEDIUM)


def _parse_category(raw: str) -> FindingCategory:
    mapping = {
        "BUG": FindingCategory.BUG,
        "SECURITY": FindingCategory.SECURITY,
        "PERFORMANCE": FindingCategory.PERFORMANCE,
        "STYLE": FindingCategory.STYLE,
        "LOGIC": FindingCategory.LOGIC,
        "CODE_SMELL": FindingCategory.CODE_SMELL,
        "DOCUMENTATION": FindingCategory.DOCUMENTATION,
    }
    return mapping.get(raw.upper(), FindingCategory.BUG)
