"""
Detect potential sub-projects inside a cloned repository.

Scans top-level directories for common project indicator files and returns
a list of candidate projects with their detected language.
"""

from __future__ import annotations

from pathlib import Path

# Maps indicator filename → display language name.
# Ordered so the most specific matches come first when multiple files exist.
_INDICATORS: dict[str, str] = {
    # Dependency/build manifests (most specific — checked first)
    "package.json":      "Node.js",
    "requirements.txt":  "Python",
    "pyproject.toml":    "Python",
    "setup.py":          "Python",
    "setup.cfg":         "Python",
    "go.mod":            "Go",
    "pom.xml":           "Java",
    "build.gradle":      "Java",
    "build.gradle.kts":  "Java",
    "Cargo.toml":        "Rust",
    "Gemfile":           "Ruby",
    "composer.json":     "PHP",
    "mix.exs":           "Elixir",
    # Framework / entry-point files (fallback when no manifest is present)
    "manage.py":         "Python",
    "app.py":            "Python",
    "main.py":           "Python",
    "tsconfig.json":     "TypeScript",
    "next.config.js":    "Next.js",
    "next.config.ts":    "Next.js",
    "nuxt.config.js":    "Nuxt.js",
    "nuxt.config.ts":    "Nuxt.js",
}

_SKIP_DIRS: frozenset[str] = frozenset({
    ".git", "node_modules", "venv", ".venv", "__pycache__",
    ".tox", "dist", "build", ".next", ".nuxt",
})


def detect_projects(repo_path: str) -> list[dict]:
    """Return candidate sub-projects found in top-level directories.

    A directory is considered a project if it contains at least one of the
    well-known project indicator files (package.json, requirements.txt, etc.).

    Args:
        repo_path: Absolute path to the cloned repository root.

    Returns:
        List of dicts with keys ``name``, ``path``, and ``language``.
        ``path`` is relative to *repo_path* (e.g. ``"backend"``).
    """
    root = Path(repo_path)
    projects: list[dict] = []

    try:
        entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return projects

    for entry in entries:
        if not entry.is_dir():
            continue
        if entry.name.startswith(".") or entry.name in _SKIP_DIRS:
            continue

        for filename, language in _INDICATORS.items():
            if (entry / filename).exists():
                projects.append({
                    "name":     entry.name,
                    "path":     entry.name,
                    "language": language,
                })
                break  # count each directory only once

    return projects
