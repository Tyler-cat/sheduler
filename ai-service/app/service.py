from __future__ import annotations

import asyncio
from typing import Iterable

from .models import JobStatus, ParseJob, ParsedEvent, Provider, ReviewDecision
from .providers import ProviderRouter
from .store import ParseJobStore


class ParseService:
    """Coordinates provider routing and job bookkeeping."""

    def __init__(self, router: ProviderRouter, store: ParseJobStore) -> None:
        self.router = router
        self.store = store

    async def submit_job(
        self,
        *,
        org_id: str,
        creator_id: str,
        provider: Provider,
        source_url: str,
        background: asyncio.AbstractEventLoop | None = None,
    ) -> ParseJob:
        job = await self.store.create_job(
            org_id=org_id,
            creator_id=creator_id,
            provider=provider,
            source_url=source_url,
        )
        loop = background or asyncio.get_running_loop()
        loop.create_task(self._execute_job(job.id))
        return job

    async def _execute_job(self, job_id: str) -> None:
        job = await self.store.get(job_id)
        if job is None:
            return
        job.mark_running()
        await self.store.update(job)
        try:
            events = await self.router.parse_with(
                job.provider,
                org_id=job.org_id,
                source_url=job.source_url,
            )
        except Exception as exc:  # pragma: no cover - defensive
            await self.store.mark_failure(job, str(exc))
            return
        await self.store.mark_success(job, list(events))

    async def get_job(self, job_id: str) -> ParseJob | None:
        return await self.store.get(job_id)

    async def list_jobs(self, org_id: str) -> Iterable[ParseJob]:
        return await self.store.list_for_org(org_id)

    async def review_job(self, job_id: str, decision: ReviewDecision) -> ParseJob | None:
        job = await self.store.get(job_id)
        if job is None:
            return None
        if job.status not in {JobStatus.SUCCEEDED, JobStatus.NEEDS_REVIEW}:
            return job
        if decision is ReviewDecision.APPROVED:
            job.metadata["review"] = "approved"
            job.status = JobStatus.SUCCEEDED
        else:
            job.metadata["review"] = "rejected"
            job.status = JobStatus.FAILED
        await self.store.update(job)
        return job
