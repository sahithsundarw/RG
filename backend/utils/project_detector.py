"""
Detect potential sub-projects inside a cloned repository.

Scans top-level directories for common project indicator files and returns
a list of candidate projects with their detected language.
"""

from __future__ import annotations

from pathlib import Path

# Primary indicators: explicit manifest / build files (highest confidence).
# First match wins when a directory has multiple files.
_MANIFEST_INDICATORS: dict[str, str] = {
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
}

# Fallback indicators: framework configs and entrypoint files used when no
# manifest is present in the directory.
_ENTRYPOINT_INDICATORS: dict[str, str] = {
    "next.config.js":  "Next.js",
    "next.config.ts":  "Next.js",
    "nuxt.config.js":  "Nuxt.js",
    "nuxt.config.ts":  "Nuxt.js",
    "tsconfig.json":   "TypeScript",
    "manage.py":       "Python",
    "app.py":          "Python",
    "main.py":         "Python",
    "index.js":        "Node.js",
    "index.ts":        "TypeScript",
    "main.go":         "Go",
    "main.rs":         "Rust",
}

_SKIP_DIRS: frozenset[str] = frozenset({
    ".git", "node_modules", "venv", ".venv", "__pycache__",
    ".tox", "dist", "build", ".next", ".nuxt",
})


def detect_projects(repo_path: str) -> list[dict]:
    """Return candidate sub-projects found in top-level directories.

    Strategy (priority order):
    1. Manifest / build files (package.json, requirements.txt, go.mod, …)
    2. Framework configs and entrypoint files (next.config.js, main.py, …)

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

        # Pass 1: manifest files (explicit project declaration)
        language: str | None = None
        for filename, lang in _MANIFEST_INDICATORS.items():
            if (entry / filename).exists():
                language = lang
                break

        # Pass 2: fall back to framework configs / entrypoint files
        if language is None:
            for filename, lang in _ENTRYPOINT_INDICATORS.items():
                if (entry / filename).exists():
                    language = lang
                    break

        if language is not None:
            projects.append({
                "name":     entry.name,
                "path":     entry.name,
                "language": language,
            })

    return projects
