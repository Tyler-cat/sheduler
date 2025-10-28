from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, MutableMapping, Protocol

from .models import ParsedEvent, Provider, ToolCall


class ProviderClient(Protocol):
    async def parse_timetable(self, *, source_url: str) -> Iterable[ParsedEvent]:
        ...


class ProviderRouterError(RuntimeError):
    """Base class for provider routing failures."""


class ProviderUnavailableError(ProviderRouterError):
    """Raised when a provider is disabled or unavailable."""


class ProviderQuotaExceededError(ProviderRouterError):
    """Raised when a provider quota would be exceeded."""


class ProviderConcurrencyLimitError(ProviderRouterError):
    """Raised when a provider has reached its concurrency limit."""


class ProviderCircuitOpenError(ProviderRouterError):
    """Raised when the provider circuit breaker is open."""


@dataclass
class ProviderRollout:
    """Controls which organizations may use a provider by default."""

    allow_by_default: bool = True
    allowlist: set[str] = field(default_factory=set)
    blocklist: set[str] = field(default_factory=set)

    def is_allowed(self, org_id: str) -> bool:
        if self.allow_by_default:
            return org_id not in self.blocklist
        return org_id in self.allowlist


@dataclass
class ProviderConfig:
    client: ProviderClient
    enabled: bool = True
    quota_per_window: int | None = None
    window_seconds: int = 60
    org_quotas: MutableMapping[str, int] | None = None
    concurrency_limit: int | None = None
    failure_threshold: int = 3
    cooldown_seconds: int = 30
    rollout: ProviderRollout | None = None


@dataclass
class ProviderState:
    window_started_at: float
    window_count: int = 0
    org_counts: Dict[str, int] = field(default_factory=dict)
    inflight: int = 0
    failure_count: int = 0
    circuit_open_until: float | None = None


class ProviderRouter:
    """Routes parsing requests while enforcing quotas and rollout settings."""

    def __init__(self) -> None:
        self._configs: Dict[Provider, ProviderConfig] = {}
        self._state: Dict[Provider, ProviderState] = {}
        self._lock = asyncio.Lock()

    def register(self, provider: Provider, client: ProviderClient, **config_kwargs) -> None:
        config = ProviderConfig(client=client, **config_kwargs)
        self._configs[provider] = config
        self._state[provider] = ProviderState(window_started_at=time.monotonic())

    def available_providers(self) -> Iterable[Provider]:
        return self._configs.keys()

    async def parse_with(self, provider: Provider, *, org_id: str, source_url: str) -> Iterable[ParsedEvent]:
        if provider not in self._configs:
            raise ValueError(f"Provider {provider} is not configured")
        async with self._lock:
            config = self._configs[provider]
            state = self._state[provider]
            now = time.monotonic()
            if not config.enabled:
                raise ProviderUnavailableError(f"Provider {provider} is disabled")
            if state.circuit_open_until and now < state.circuit_open_until:
                raise ProviderCircuitOpenError(f"Provider {provider} is cooling down")
            if config.rollout and not config.rollout.is_allowed(org_id):
                raise ProviderUnavailableError(
                    f"Provider {provider} is not enabled for organization {org_id}"
                )
            # reset rolling window counters
            if now - state.window_started_at >= config.window_seconds:
                state.window_started_at = now
                state.window_count = 0
                state.org_counts = {}
            if config.quota_per_window is not None and state.window_count >= config.quota_per_window:
                raise ProviderQuotaExceededError(f"Provider {provider} global quota exceeded")
            if config.org_quotas:
                org_quota = config.org_quotas.get(org_id)
                if org_quota is not None and state.org_counts.get(org_id, 0) >= org_quota:
                    raise ProviderQuotaExceededError(
                        f"Provider {provider} quota exceeded for organization {org_id}"
                    )
            if config.concurrency_limit is not None and state.inflight >= config.concurrency_limit:
                raise ProviderConcurrencyLimitError(
                    f"Provider {provider} has reached its concurrency limit"
                )
            # update counters for this window before releasing lock
            state.window_count += 1
            state.org_counts[org_id] = state.org_counts.get(org_id, 0) + 1
            state.inflight += 1
        try:
            events = await config.client.parse_timetable(source_url=source_url)
        except Exception:
            async with self._lock:
                state = self._state[provider]
                state.inflight = max(0, state.inflight - 1)
                state.failure_count += 1
                if state.failure_count >= self._configs[provider].failure_threshold:
                    state.circuit_open_until = time.monotonic() + self._configs[provider].cooldown_seconds
                    state.failure_count = 0
            raise
        else:
            async with self._lock:
                state = self._state[provider]
                state.inflight = max(0, state.inflight - 1)
                state.failure_count = 0
            return events


class StubProvider:
    """Simple stub that returns deterministic sample data."""

    def __init__(self, *, label: str) -> None:
        self.label = label

    async def parse_timetable(self, *, source_url: str) -> Iterable[ParsedEvent]:
        seed = hash((self.label, source_url)) & 0xFFFFFFFF
        random.seed(seed)
        confidence = round(random.uniform(0.55, 0.95), 2)
        tool_calls = []
        if confidence < 0.65:
            tool_calls.append(
                ToolCall(
                    type="notify_admin",
                    payload={"reason": "low_confidence", "source_url": source_url},
                    needs_approval=False,
                )
            )
        return [
            ParsedEvent(
                title=f"Auto Generated ({self.label})",
                weekday=random.randint(1, 5),
                start="09:00",
                end="10:30",
                location="Room 101",
                assignees=["instructor-1"],
                confidence=confidence,
                tool_calls=tool_calls,
            )
        ]
