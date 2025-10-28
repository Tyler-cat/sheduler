from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, HttpUrl

from .models import JobStatus, Provider, ReviewDecision


class ParseJobCreate(BaseModel):
    org_id: str = Field(..., alias="orgId")
    creator_id: str = Field(..., alias="creatorId")
    source_url: HttpUrl = Field(..., alias="sourceUrl")
    provider: Provider

    class Config:
        populate_by_name = True


class ToolCallSchema(BaseModel):
    type: str
    payload: dict
    needs_approval: bool = Field(False, alias="needsApproval")

    class Config:
        populate_by_name = True


class ParsedEventSchema(BaseModel):
    title: str
    weekday: int
    start: str
    end: str
    location: Optional[str]
    assignees: List[str]
    confidence: float
    tool_calls: List[ToolCallSchema] = Field(default_factory=list, alias="toolCalls")

    class Config:
        populate_by_name = True


class ParseJobSchema(BaseModel):
    id: str
    org_id: str = Field(..., alias="orgId")
    creator_id: str = Field(..., alias="creatorId")
    provider: Provider
    source_url: HttpUrl = Field(..., alias="sourceUrl")
    status: JobStatus
    events: List[ParsedEventSchema]
    error: Optional[str]
    metadata: dict

    class Config:
        populate_by_name = True


class ReviewRequest(BaseModel):
    decision: ReviewDecision
