from __future__ import annotations

from fastapi import FastAPI, HTTPException, status

from .models import Provider
from .providers import ProviderRouter, StubProvider
from .schemas import ParseJobCreate, ParseJobSchema, ReviewRequest
from .service import ParseService
from .store import ParseJobStore

app = FastAPI(title="Scheduler AI Service", version="0.1.0")

store = ParseJobStore()
service = ParseService(router=ProviderRouter(), store=store)

# Pre-register stub providers
service.router.register(Provider.OPENAI, StubProvider(label="openai"))
service.router.register(Provider.OPENROUTER, StubProvider(label="openrouter"))
service.router.register(Provider.QWEN_LOCAL, StubProvider(label="qwen"))


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse/jobs", response_model=ParseJobSchema, status_code=status.HTTP_202_ACCEPTED)
async def submit_parse_job(payload: ParseJobCreate) -> ParseJobSchema:
    job = await service.submit_job(
        org_id=payload.org_id,
        creator_id=payload.creator_id,
        provider=payload.provider,
        source_url=str(payload.source_url),
    )
    return ParseJobSchema.model_validate(job, from_attributes=True)


@app.get("/parse/jobs/{job_id}", response_model=ParseJobSchema)
async def get_parse_job(job_id: str) -> ParseJobSchema:
    job = await service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job_not_found")
    return ParseJobSchema.model_validate(job, from_attributes=True)


@app.post("/parse/jobs/{job_id}/review", response_model=ParseJobSchema)
async def review_parse_job(job_id: str, request: ReviewRequest) -> ParseJobSchema:
    job = await service.review_job(job_id, request.decision)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job_not_found")
    return ParseJobSchema.model_validate(job, from_attributes=True)


@app.get("/parse/jobs", response_model=list[ParseJobSchema])
async def list_jobs(org_id: str) -> list[ParseJobSchema]:
    jobs = await service.list_jobs(org_id)
    return [ParseJobSchema.model_validate(job, from_attributes=True) for job in jobs]
