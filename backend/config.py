"""
Central configuration for RepoGuardian.
All values can be overridden via environment variables or .env file.
"""

import os
import tempfile
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ────────────────────────────────────────────────────────────
    app_name: str = "RepoGuardian"
    app_version: str = "1.0.0"
    debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    environment: Literal["local", "development", "staging", "production"] = "local"

    # ── API Server ─────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    # Comma-separated origins or list; defaults cover local dev (vite :3000/:5173 + preview :4173)
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
    ]

    # ── Redis ──────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    redis_event_stream: str = "repoguardian:events"
    redis_consumer_group: str = "repoguardian-workers"
    redis_results_channel: str = "repoguardian:results"
    redis_state_prefix: str = "repoguardian:state:"
    redis_stream_max_len: int = 10_000

    # ── ChromaDB ───────────────────────────────────────────────────────────────
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    chroma_collection_code: str = "code_embeddings"

    # ── OpenAI ─────────────────────────────────────────────────────────────────
    openai_api_key: str = Field(..., description="OpenAI API key")
    claude_model: str = "gpt-4o"
    claude_max_tokens_output: int = 4096
    claude_temperature: float = 0.1

    # ── Frontend URL (for CORS) ────────────────────────────────────────────────
    frontend_url: str = ""

    # ── GitHub ─────────────────────────────────────────────────────────────────
    github_app_id: str = ""
    github_private_key_path: str = ""
    github_webhook_secret: str = Field(
        default="", description="HMAC secret for webhook signature verification"
    )
    github_token: str = Field("", description="Personal access token (dev/testing)")

    # ── Context Retrieval ──────────────────────────────────────────────────────
    context_total_token_budget: int = 60_000
    context_diff_max_tokens: int = 12_000
    context_definitions_max_tokens: int = 20_000
    context_call_graph_max_tokens: int = 10_000
    context_tests_max_tokens: int = 8_000
    context_semantic_max_tokens: int = 7_000
    context_manifests_max_tokens: int = 5_000
    context_docs_max_tokens: int = 4_000
    context_structure_max_tokens: int = 1_500

    # ── Agent Behaviour ────────────────────────────────────────────────────────
    agent_timeout_seconds: int = 90
    agent_max_retries: int = 3
    agent_confidence_threshold: float = 0.65
    security_confidence_bias: float = 0.55
    self_consistency_runs: int = 3

    # ── Health Score Weights ───────────────────────────────────────────────────
    health_weight_code_quality: float = 0.25
    health_weight_security: float = 0.30
    health_weight_dependencies: float = 0.20
    health_weight_documentation: float = 0.15
    health_weight_test_coverage: float = 0.10

    health_penalty_critical: float = 20.0
    health_penalty_high: float = 8.0
    health_penalty_medium: float = 3.0
    health_penalty_low: float = 1.0
    health_penalty_info: float = 0.2

    # ── HITL ───────────────────────────────────────────────────────────────────
    hitl_timeout_days: int = 7
    hitl_block_merge_on_critical: bool = True
    hitl_auto_resolve_on_merge_severity: list[str] = ["MEDIUM", "LOW", "INFO"]

    # ── Worker ─────────────────────────────────────────────────────────────────
    worker_concurrency: int = 4
    worker_poll_interval_ms: int = 100

    # ── Rate Limiting ──────────────────────────────────────────────────────────
    max_reviews_per_repo_daily: int = 50
    max_reviews_per_org_daily: int = 500

    # ── Temporary storage ─────────────────────────────────────────────────────
    # Defaults to OS temp dir so it works on both Linux/macOS and Windows
    clone_base_dir: str = os.path.join(tempfile.gettempdir(), "repoguardian", "clones")

    @field_validator("health_weight_code_quality")
    @classmethod
    def weights_must_sum_to_one(cls, v: float, info) -> float:  # noqa: N805
        return v

    @property
    def health_weights_valid(self) -> bool:
        total = (
            self.health_weight_code_quality
            + self.health_weight_security
            + self.health_weight_dependencies
            + self.health_weight_documentation
            + self.health_weight_test_coverage
        )
        return abs(total - 1.0) < 1e-6


@lru_cache
def get_settings() -> Settings:
    """Return cached settings singleton."""
    return Settings()
