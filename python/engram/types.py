"""Pydantic models matching Engram TypeScript types."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class MemoryTier(str, Enum):
    working = "working"
    episodic = "episodic"
    semantic = "semantic"


class SharingVisibility(str, Enum):
    private = "private"
    team = "team"
    public = "public"


class WorkingEntry(BaseModel):
    key: str
    value: str
    agent_id: str = Field(alias="agentId")
    created_at: int = Field(alias="createdAt")
    expires_at: int = Field(alias="expiresAt")
    access_count: int = Field(alias="accessCount")
    last_accessed_at: int = Field(alias="lastAccessedAt")

    model_config = {"populate_by_name": True}


class Episode(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    who: str
    what: str
    context: str = ""
    outcome: str = ""
    timestamp: int
    visibility: SharingVisibility = SharingVisibility.private
    access_count: int = Field(0, alias="accessCount")
    last_accessed_at: int = Field(0, alias="lastAccessedAt")
    expires_at: int | None = Field(None, alias="expiresAt")
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class SemanticFact(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    fact: str
    topic: str
    confidence: float = 1.0
    source_episode_ids: list[str] = Field(default_factory=list, alias="sourceEpisodeIds")
    visibility: SharingVisibility = SharingVisibility.private
    access_count: int = Field(0, alias="accessCount")
    last_accessed_at: int = Field(0, alias="lastAccessedAt")
    last_verified_at: int = Field(0, alias="lastVerifiedAt")
    created_at: int = Field(0, alias="createdAt")
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class Memory(BaseModel):
    tier: MemoryTier
    data: dict[str, Any]


class RecallFilters(BaseModel):
    tiers: list[MemoryTier] | None = None
    agent_id: str | None = Field(None, alias="agentId")
    max_results: int | None = Field(None, alias="maxResults")
    min_confidence: float | None = Field(None, alias="minConfidence")
    max_tokens: int | None = Field(None, alias="maxTokens")

    model_config = {"populate_by_name": True}


class RecallResult(BaseModel):
    memories: list[Memory]
    total_tokens: int = Field(alias="totalTokens")
    query: str
    filters: dict[str, Any]

    model_config = {"populate_by_name": True}


class TierStats(BaseModel):
    count: int
    total_size: int = Field(alias="totalSize")

    model_config = {"populate_by_name": True}


class EpisodicStats(TierStats):
    avg_age: float = Field(alias="avgAge")


class SemanticStats(TierStats):
    avg_confidence: float = Field(alias="avgConfidence")


class MemoryStats(BaseModel):
    working: TierStats
    episodic: EpisodicStats
    semantic: SemanticStats
    quarantined: int
    audit_entries: int = Field(alias="auditEntries")

    model_config = {"populate_by_name": True}


class ForgettingReport(BaseModel):
    policy: str
    deleted: int
    demoted: int
    retained: int
    reasons: list[dict[str, Any]]
    executed_at: int = Field(alias="executedAt")

    model_config = {"populate_by_name": True}


class HealthResponse(BaseModel):
    status: str
    timestamp: int


class StoreResult(BaseModel):
    stored: bool
    tier: MemoryTier | None = None
    id: str | None = None
    key: str | None = None


class ShareResult(BaseModel):
    success: bool


class DeleteResult(BaseModel):
    deleted: bool
