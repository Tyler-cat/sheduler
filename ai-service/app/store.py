from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional
import uuid

from .models import JobStatus, ParseJob, ParsedEvent, Provider


class ParseJobStore:
    """Thread-safe in-memory store for parse jobs."""

    def __init__(self) -> None:
        self._jobs: Dict[str, ParseJob] = {}
        self._lock = asyncio.Lock()

    async def create_job(
        self,
        *,
        org_id: str,
        creator_id: str,
        provider: Provider,
        source_url: str,
    ) -> ParseJob:
        job = ParseJob(
            id=str(uuid.uuid4()),
            org_id=org_id,
            creator_id=creator_id,
            provider=provider,
            source_url=source_url,
            created_at=datetime.now(timezone.utc),
            status=JobStatus.PENDING,
        )
        async with self._lock:
            self._jobs[job.id] = job
        return job

    async def get(self, job_id: str) -> Optional[ParseJob]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def list_for_org(self, org_id: str) -> List[ParseJob]:
        async with self._lock:
            return [job for job in self._jobs.values() if job.org_id == org_id]

    async def update(self, job: ParseJob) -> None:
        async with self._lock:
            self._jobs[job.id] = job

    async def mark_success(self, job: ParseJob, events: List[ParsedEvent]) -> ParseJob:
        job.mark_succeeded(events)
        await self.update(job)
        return job

    async def mark_failure(self, job: ParseJob, error: str) -> ParseJob:
        job.mark_failed(error)
        await self.update(job)
        return job
