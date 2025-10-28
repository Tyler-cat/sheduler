from __future__ import annotations

import asyncio
import pathlib
import sys
import importlib.util
import time

import pytest

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.models import JobStatus, ParsedEvent, Provider, ReviewDecision
from app.providers import (
    ProviderCircuitOpenError,
    ProviderConcurrencyLimitError,
    ProviderQuotaExceededError,
    ProviderRollout,
    ProviderRouter,
    ProviderUnavailableError,
    StubProvider,
)
from app.service import ParseService
from app.store import ParseJobStore


_fastapi_spec = importlib.util.find_spec("fastapi")
if _fastapi_spec is not None:  # pragma: no cover - exercised when dependency is available
    from fastapi.testclient import TestClient

    from app.main import app
else:  # pragma: no cover - executed in environments without fastapi
    TestClient = None
    app = None


def test_service_submit_and_review_flow():
    router = ProviderRouter()
    router.register(Provider.OPENAI, StubProvider(label="openai"))
    router.register(Provider.OPENROUTER, StubProvider(label="openrouter"))
    store = ParseJobStore()
    service = ParseService(router=router, store=store)

    async def scenario():
        job = await service.submit_job(
            org_id="org-1",
            creator_id="user-1",
            provider=Provider.OPENAI,
            source_url="https://example.com/sample.png",
        )
        await asyncio.sleep(0.05)

        stored = await service.get_job(job.id)
        assert stored is not None
        assert stored.status in {JobStatus.SUCCEEDED, JobStatus.NEEDS_REVIEW}
        assert stored.events

        reviewed = await service.review_job(job.id, ReviewDecision.APPROVED)
        assert reviewed is not None
        assert reviewed.metadata.get("review") == "approved"
        assert reviewed.status == JobStatus.SUCCEEDED

    asyncio.run(scenario())


def test_service_list_jobs_filters_org():
    router = ProviderRouter()
    router.register(Provider.QWEN_LOCAL, StubProvider(label="qwen"))
    store = ParseJobStore()
    service = ParseService(router=router, store=store)

    async def scenario():
        await service.submit_job(
            org_id="org-1",
            creator_id="user-1",
            provider=Provider.QWEN_LOCAL,
            source_url="https://example.com/a.png",
        )
        await service.submit_job(
            org_id="org-2",
            creator_id="user-2",
            provider=Provider.QWEN_LOCAL,
            source_url="https://example.com/b.png",
        )
        await asyncio.sleep(0.05)

        jobs_org1 = await service.list_jobs("org-1")
        assert jobs_org1
        assert all(job.org_id == "org-1" for job in jobs_org1)

    asyncio.run(scenario())


class _SlowProvider:
    def __init__(self, *, delay: float = 0.05, failures: int = 0) -> None:
        self.delay = delay
        self.failures = failures

    async def parse_timetable(self, *, source_url: str):
        await asyncio.sleep(self.delay)
        if self.failures > 0:
            self.failures -= 1
            raise RuntimeError("upstream failure")
        return [
            ParsedEvent(
                title="ok",
                weekday=1,
                start="09:00",
                end="10:00",
                assignees=[],
                location=None,
                confidence=0.9,
                tool_calls=[],
            )
        ]


def test_provider_router_quota_and_rollout():
    router = ProviderRouter()
    router.register(
        Provider.OPENAI,
        StubProvider(label="openai"),
        quota_per_window=1,
        window_seconds=60,
        org_quotas={"org-1": 1},
        rollout=ProviderRollout(allow_by_default=False, allowlist={"org-1"}),
    )

    async def scenario():
        await router.parse_with(Provider.OPENAI, org_id="org-1", source_url="https://a")
        with pytest.raises(ProviderQuotaExceededError):
            await router.parse_with(Provider.OPENAI, org_id="org-1", source_url="https://b")
        with pytest.raises(ProviderUnavailableError):
            await router.parse_with(Provider.OPENAI, org_id="org-2", source_url="https://c")

    asyncio.run(scenario())


def test_provider_router_concurrency_and_circuit_breaker():
    router = ProviderRouter()
    slow_provider = _SlowProvider(delay=0.05, failures=2)
    router.register(
        Provider.OPENROUTER,
        slow_provider,
        concurrency_limit=1,
        failure_threshold=2,
        cooldown_seconds=0.05,
    )

    async def scenario():
        # concurrency guard
        first = asyncio.create_task(
            router.parse_with(Provider.OPENROUTER, org_id="org-1", source_url="https://a")
        )
        await asyncio.sleep(0.01)
        with pytest.raises(ProviderConcurrencyLimitError):
            await router.parse_with(Provider.OPENROUTER, org_id="org-1", source_url="https://b")
        with pytest.raises(RuntimeError):
            await first

        # circuit breaker engages after consecutive failures
        with pytest.raises(RuntimeError):
            await router.parse_with(Provider.OPENROUTER, org_id="org-1", source_url="https://c")
        with pytest.raises(RuntimeError):
            await router.parse_with(Provider.OPENROUTER, org_id="org-1", source_url="https://d")
        with pytest.raises(ProviderCircuitOpenError):
            await router.parse_with(Provider.OPENROUTER, org_id="org-1", source_url="https://e")
        await asyncio.sleep(0.06)
        slow_provider.failures = 0
        events = await router.parse_with(
            Provider.OPENROUTER, org_id="org-1", source_url="https://f"
        )
        assert events

    asyncio.run(scenario())


@pytest.mark.skipif(TestClient is None, reason="fastapi dependency is unavailable")
def test_http_submit_and_review_flow():  # pragma: no cover - requires fastapi runtime
    assert app is not None
    client = TestClient(app)
    response = client.post(
        "/parse/jobs",
        json={
            "orgId": "org-1",
            "creatorId": "user-1",
            "sourceUrl": "https://example.com/sample.png",
            "provider": "OPENAI",
        },
    )
    assert response.status_code == 202
    job = response.json()
    assert job["status"] == JobStatus.PENDING.value

    job_id = job["id"]
    time.sleep(0.1)

    job_response = client.get(f"/parse/jobs/{job_id}")
    assert job_response.status_code == 200
    body = job_response.json()
    assert body["status"] in {JobStatus.SUCCEEDED.value, JobStatus.NEEDS_REVIEW.value}
    assert len(body["events"]) == 1

    review_response = client.post(
        f"/parse/jobs/{job_id}/review",
        json={"decision": "APPROVED"},
    )
    assert review_response.status_code == 200
    review_body = review_response.json()
    assert review_body["status"] == JobStatus.SUCCEEDED.value
    assert review_body["metadata"]["review"] == "approved"


@pytest.mark.skipif(TestClient is None, reason="fastapi dependency is unavailable")
def test_http_list_jobs_filters_by_org():  # pragma: no cover - requires fastapi runtime
    assert app is not None
    client = TestClient(app)
    response = client.get("/parse/jobs", params={"org_id": "org-1"})
    assert response.status_code == 200
    jobs = response.json()
    assert all(job["orgId"] == "org-1" for job in jobs)
