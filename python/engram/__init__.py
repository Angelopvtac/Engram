"""Engram Python SDK — client for the Engram memory REST API."""

from .client import AsyncEngramClient, EngramClient
from .types import (
    DeleteResult,
    Episode,
    ForgettingReport,
    HealthResponse,
    Memory,
    MemoryStats,
    MemoryTier,
    RecallResult,
    SemanticFact,
    ShareResult,
    SharingVisibility,
    StoreResult,
    WorkingEntry,
)

__all__ = [
    "EngramClient",
    "AsyncEngramClient",
    "MemoryTier",
    "SharingVisibility",
    "WorkingEntry",
    "Episode",
    "SemanticFact",
    "Memory",
    "RecallResult",
    "MemoryStats",
    "ForgettingReport",
    "HealthResponse",
    "StoreResult",
    "ShareResult",
    "DeleteResult",
]

__version__ = "0.1.0"
