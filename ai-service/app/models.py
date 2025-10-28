from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class Provider(str, Enum):
    OPENAI = "OPENAI"
    OPENROUTER = "OPENROUTER"
    QWEN_LOCAL = "QWEN_LOCAL"


class JobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


@dataclass(slots=True)
class ToolCall:
    type: str
    payload: Dict[str, Any]
    needs_approval: bool = False


@dataclass(slots=True)
class ParsedEvent:
    title: str
    weekday: int
    start: str
    end: str
    location: Optional[str]
    assignees: List[str]
    confidence: float
    tool_calls: List[ToolCall] = field(default_factory=list)


@dataclass(slots=True)
class ParseJob:
    id: str
    org_id: str
    creator_id: str
    provider: Provider
    source_url: str
    created_at: datetime
    status: JobStatus
    events: List[ParsedEvent] = field(default_factory=list)
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def mark_running(self) -> None:
        self.status = JobStatus.RUNNING

    def mark_failed(self, message: str) -> None:
        self.status = JobStatus.FAILED
        self.error = message

    def mark_succeeded(self, events: List[ParsedEvent]) -> None:
        self.events = events
        needs_review = any(event.confidence < 0.6 for event in events)
        self.status = JobStatus.NEEDS_REVIEW if needs_review else JobStatus.SUCCEEDED


class ReviewDecision(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
