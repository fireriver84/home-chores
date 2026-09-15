"""Recurrence helpers used by Home Chores."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def period_start(now: datetime, frequency: str) -> datetime:
    """Return the start of the active recurrence period."""
    if frequency == "week":
        start = now - timedelta(days=now.weekday())
        return start.replace(hour=0, minute=0, second=0, microsecond=0)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def is_available_today(schedule: dict[str, Any], now: datetime) -> bool:
    """Return whether a chore is scheduled on the current weekday."""
    weekdays = schedule.get("weekdays") or []
    return not weekdays or now.weekday() in weekdays

