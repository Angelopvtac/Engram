"""Engram Python SDK client wrapping the REST API."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from .types import (
    DeleteResult,
    ForgettingReport,
    HealthResponse,
    MemoryStats,
    MemoryTier,
    RecallResult,
    ShareResult,
    SharingVisibility,
    StoreResult,
    WorkingEntry,
)


class EngramClient:
    """Synchronous client for the Engram REST API.

    Args:
        base_url: Base URL of the Engram API server.
            Defaults to http://localhost:3847.
        timeout: Request timeout in seconds. Defaults to 30.

    Example::

        from engram import EngramClient

        client = EngramClient()
        client.store(
            tier="episodic",
            agent_id="agent-1",
            who="user",
            what="Asked about project deadlines",
            context="standup meeting",
            outcome="Provided Q2 timeline",
        )
        result = client.recall("project deadlines", agent_id="agent-1")
        for mem in result.memories:
            print(mem.tier, mem.data)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3847",
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self._base_url, timeout=timeout)

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "EngramClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # --- Core operations ---

    def store(
        self,
        tier: str | MemoryTier,
        agent_id: str,
        *,
        # Working memory
        key: str | None = None,
        value: str | None = None,
        ttl_ms: int | None = None,
        # Episodic memory
        who: str | None = None,
        what: str | None = None,
        context: str | None = None,
        outcome: str | None = None,
        # Semantic memory
        fact: str | None = None,
        topic: str | None = None,
        confidence: float | None = None,
        # Common
        visibility: str | SharingVisibility | None = None,
    ) -> StoreResult:
        """Store a memory."""
        body: dict[str, Any] = {"tier": str(tier), "agentId": agent_id}
        for k, v in [
            ("key", key), ("value", value), ("ttlMs", ttl_ms),
            ("who", who), ("what", what), ("context", context), ("outcome", outcome),
            ("fact", fact), ("topic", topic), ("confidence", confidence),
            ("visibility", str(visibility) if visibility else None),
        ]:
            if v is not None:
                body[k] = v

        resp = self._client.post("/api/v1/store", json=body)
        resp.raise_for_status()
        return StoreResult.model_validate(resp.json())

    def recall(
        self,
        query: str,
        *,
        agent_id: str | None = None,
        tiers: list[str | MemoryTier] | None = None,
        max_results: int | None = None,
        min_confidence: float | None = None,
        max_tokens: int | None = None,
    ) -> RecallResult:
        """Recall memories matching a query."""
        body: dict[str, Any] = {"query": query}
        if agent_id:
            body["agentId"] = agent_id
        if tiers:
            body["tiers"] = [str(t) for t in tiers]
        if max_results is not None:
            body["maxResults"] = max_results
        if min_confidence is not None:
            body["minConfidence"] = min_confidence
        if max_tokens is not None:
            body["maxTokens"] = max_tokens

        resp = self._client.post("/api/v1/recall", json=body)
        resp.raise_for_status()
        return RecallResult.model_validate(resp.json())

    def forget(
        self,
        policy_name: str,
        policy_type: str,
        *,
        agent_id: str | None = None,
        target: str | None = None,
        confidence_threshold: float | None = None,
        inactive_days: int | None = None,
    ) -> ForgettingReport:
        """Run a forgetting policy."""
        body: dict[str, Any] = {
            "policyName": policy_name,
            "policyType": policy_type,
        }
        if agent_id:
            body["agentId"] = agent_id
        if target:
            body["target"] = target
        if confidence_threshold is not None:
            body["confidenceThreshold"] = confidence_threshold
        if inactive_days is not None:
            body["inactiveDays"] = inactive_days

        resp = self._client.post("/api/v1/forget", json=body)
        resp.raise_for_status()
        return ForgettingReport.model_validate(resp.json())

    def stats(self, agent_id: str | None = None) -> MemoryStats:
        """Get memory statistics."""
        params = {}
        if agent_id:
            params["agentId"] = agent_id
        resp = self._client.get("/api/v1/stats", params=params)
        resp.raise_for_status()
        return MemoryStats.model_validate(resp.json())

    def share(
        self,
        memory_id: str,
        tier: str | MemoryTier,
        visibility: str | SharingVisibility,
    ) -> ShareResult:
        """Share a memory with a target visibility."""
        resp = self._client.post("/api/v1/share", json={
            "memoryId": memory_id,
            "tier": str(tier),
            "visibility": str(visibility),
        })
        resp.raise_for_status()
        return ShareResult.model_validate(resp.json())

    def revoke(self, memory_id: str, tier: str | MemoryTier) -> ShareResult:
        """Revoke sharing on a memory."""
        resp = self._client.post("/api/v1/revoke", json={
            "memoryId": memory_id,
            "tier": str(tier),
        })
        resp.raise_for_status()
        return ShareResult.model_validate(resp.json())

    # --- Working memory operations ---

    def working_list(self, agent_id: str) -> list[WorkingEntry]:
        """List all working memory entries for an agent."""
        resp = self._client.get(f"/api/v1/working/{quote(agent_id, safe='')}")
        resp.raise_for_status()
        return [WorkingEntry.model_validate(e) for e in resp.json()]

    def working_get(self, agent_id: str, key: str) -> WorkingEntry | None:
        """Get a specific working memory entry."""
        resp = self._client.get(f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return WorkingEntry.model_validate(resp.json())

    def working_set(
        self, agent_id: str, key: str, value: str, ttl_ms: int = 300_000
    ) -> None:
        """Set a working memory key-value pair."""
        resp = self._client.put(
            f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}",
            json={"value": value, "ttlMs": ttl_ms},
        )
        resp.raise_for_status()

    def working_delete(self, agent_id: str, key: str) -> DeleteResult:
        """Delete a working memory entry."""
        resp = self._client.delete(f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}")
        resp.raise_for_status()
        return DeleteResult.model_validate(resp.json())

    def health(self) -> HealthResponse:
        """Check API health."""
        resp = self._client.get("/api/v1/health")
        resp.raise_for_status()
        return HealthResponse.model_validate(resp.json())


class AsyncEngramClient:
    """Async client for the Engram REST API.

    Uses httpx.AsyncClient under the hood. Use with `async with` or
    call `.close()` when done.

    Example::

        import asyncio
        from engram import AsyncEngramClient

        async def main():
            async with AsyncEngramClient() as client:
                result = await client.recall("project deadlines")
                print(result)

        asyncio.run(main())
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3847",
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncEngramClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def store(
        self,
        tier: str | MemoryTier,
        agent_id: str,
        **kwargs: Any,
    ) -> StoreResult:
        body: dict[str, Any] = {"tier": str(tier), "agentId": agent_id}
        key_map = {
            "key": "key", "value": "value", "ttl_ms": "ttlMs",
            "who": "who", "what": "what", "context": "context", "outcome": "outcome",
            "fact": "fact", "topic": "topic", "confidence": "confidence",
            "visibility": "visibility",
        }
        for py_key, json_key in key_map.items():
            val = kwargs.get(py_key)
            if val is not None:
                body[json_key] = str(val) if json_key == "visibility" else val
        resp = await self._client.post("/api/v1/store", json=body)
        resp.raise_for_status()
        return StoreResult.model_validate(resp.json())

    async def recall(self, query: str, **kwargs: Any) -> RecallResult:
        body: dict[str, Any] = {"query": query}
        if kwargs.get("agent_id"):
            body["agentId"] = kwargs["agent_id"]
        if kwargs.get("tiers"):
            body["tiers"] = [str(t) for t in kwargs["tiers"]]
        if kwargs.get("max_results") is not None:
            body["maxResults"] = kwargs["max_results"]
        if kwargs.get("min_confidence") is not None:
            body["minConfidence"] = kwargs["min_confidence"]
        if kwargs.get("max_tokens") is not None:
            body["maxTokens"] = kwargs["max_tokens"]
        resp = await self._client.post("/api/v1/recall", json=body)
        resp.raise_for_status()
        return RecallResult.model_validate(resp.json())

    async def forget(self, policy_name: str, policy_type: str, **kwargs: Any) -> ForgettingReport:
        body: dict[str, Any] = {"policyName": policy_name, "policyType": policy_type}
        if kwargs.get("agent_id"):
            body["agentId"] = kwargs["agent_id"]
        if kwargs.get("target"):
            body["target"] = kwargs["target"]
        resp = await self._client.post("/api/v1/forget", json=body)
        resp.raise_for_status()
        return ForgettingReport.model_validate(resp.json())

    async def stats(self, agent_id: str | None = None) -> MemoryStats:
        params = {"agentId": agent_id} if agent_id else {}
        resp = await self._client.get("/api/v1/stats", params=params)
        resp.raise_for_status()
        return MemoryStats.model_validate(resp.json())

    async def share(self, memory_id: str, tier: str, visibility: str) -> ShareResult:
        resp = await self._client.post("/api/v1/share", json={
            "memoryId": memory_id, "tier": tier, "visibility": visibility,
        })
        resp.raise_for_status()
        return ShareResult.model_validate(resp.json())

    async def revoke(self, memory_id: str, tier: str) -> ShareResult:
        resp = await self._client.post("/api/v1/revoke", json={
            "memoryId": memory_id, "tier": tier,
        })
        resp.raise_for_status()
        return ShareResult.model_validate(resp.json())

    async def working_list(self, agent_id: str) -> list[WorkingEntry]:
        resp = await self._client.get(f"/api/v1/working/{quote(agent_id, safe='')}")
        resp.raise_for_status()
        return [WorkingEntry.model_validate(e) for e in resp.json()]

    async def working_get(self, agent_id: str, key: str) -> WorkingEntry | None:
        resp = await self._client.get(f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return WorkingEntry.model_validate(resp.json())

    async def working_set(self, agent_id: str, key: str, value: str, ttl_ms: int = 300_000) -> None:
        resp = await self._client.put(
            f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}",
            json={"value": value, "ttlMs": ttl_ms},
        )
        resp.raise_for_status()

    async def working_delete(self, agent_id: str, key: str) -> DeleteResult:
        resp = await self._client.delete(f"/api/v1/working/{quote(agent_id, safe='')}/{quote(key, safe='')}")
        resp.raise_for_status()
        return DeleteResult.model_validate(resp.json())

    async def health(self) -> HealthResponse:
        resp = await self._client.get("/api/v1/health")
        resp.raise_for_status()
        return HealthResponse.model_validate(resp.json())
