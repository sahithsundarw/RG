"""
Real-time event broadcast via SSE.

GET /api/events/stream — subscribe to live webhook/audit notifications
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/events", tags=["events"])

# Global set of subscriber queues — one per connected client
_subscribers: set[asyncio.Queue] = set()


async def broadcast(event: dict) -> None:
    """Push an event to every connected SSE subscriber."""
    dead: set[asyncio.Queue] = set()
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.add(q)
    _subscribers.difference_update(dead)
    logger.info(
        "[events] broadcast type=%s to %d subscribers (%d dropped)",
        event.get("type"), len(_subscribers), len(dead),
    )


@router.get("/stream")
async def events_stream() -> StreamingResponse:
    """SSE stream — yields a notification whenever a webhook event is processed."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    _subscribers.add(queue)
    logger.info("[events] SSE client connected, total subscribers: %d", len(_subscribers))

    async def generator() -> AsyncIterator[str]:
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        finally:
            _subscribers.discard(queue)
            logger.info("[events] SSE client disconnected, total subscribers: %d", len(_subscribers))

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
