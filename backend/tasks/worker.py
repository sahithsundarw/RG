"""
Background worker.

Continuously reads events from the Redis Stream and dispatches them
to the Orchestrator for processing.

Run this as a separate process alongside the FastAPI app:
  python -m backend.tasks.worker
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

from backend.agents.orchestrator import Orchestrator
from backend.config import get_settings
from backend.services.github_service import GitHubAPIClient
from backend.services.redis_service import (
    EventQueueConsumer,
    StateStore,
    close_redis,
    get_redis,
)

logger = logging.getLogger(__name__)
settings = get_settings()

_shutdown = asyncio.Event()


async def main() -> None:
    """Main worker entry point."""
    logging.basicConfig(
        level=getattr(logging, settings.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    logger.info("RepoGuardian worker starting...")

    redis = await get_redis()
    state = StateStore(redis)
    github_client = GitHubAPIClient(settings.github_token)
    orchestrator = Orchestrator(github_client, state)

    consumer_name = f"worker-{os.getpid()}"
    consumer = EventQueueConsumer(redis, consumer_name)
    await consumer.ensure_group()

    sem = asyncio.Semaphore(settings.worker_concurrency)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _shutdown.set)

    logger.info(
        "Worker '%s' ready — listening on stream '%s'",
        consumer_name, settings.redis_event_stream,
    )

    asyncio.create_task(_reclaim_stale_entries(consumer))

    while not _shutdown.is_set():
        try:
            entries = await consumer.read_next(
                count=settings.worker_concurrency,
                block_ms=settings.worker_poll_interval_ms,
            )
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Stream read error: %s", e)
            await asyncio.sleep(1)
            continue

        for entry_id, event in entries:
            asyncio.create_task(
                _process_event(entry_id, event, consumer, orchestrator, sem)
            )

    logger.info("Worker shutting down...")
    await close_redis()


async def _process_event(entry_id, event, consumer, orchestrator, sem) -> None:
    """Process a single event under the concurrency semaphore."""
    async with sem:
        try:
            await orchestrator.process_event(event)
            await consumer.ack(entry_id)
            logger.info("ACKed event %s (%s)", event.event_id, entry_id)
        except Exception as e:
            logger.error(
                "Failed to process event %s: %s — leaving in PEL for retry",
                event.event_id, e,
            )


async def _reclaim_stale_entries(consumer: EventQueueConsumer) -> None:
    """Periodically reclaim PEL entries older than 5 minutes."""
    while not _shutdown.is_set():
        await asyncio.sleep(60)
        try:
            r = await get_redis()
            await r.execute_command(
                "XAUTOCLAIM",
                settings.redis_event_stream,
                settings.redis_consumer_group,
                consumer._consumer,
                300_000,
                "0-0",
            )
        except Exception as e:
            logger.debug("PEL reclaim skipped: %s", e)


if __name__ == "__main__":
    asyncio.run(main())
