"""Tests for recurrence boundaries."""

from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

SPEC = spec_from_file_location(
    "home_chores_schedule",
    Path(__file__).parents[1] / "custom_components" / "home_chores" / "schedule.py",
)
assert SPEC and SPEC.loader
schedule = module_from_spec(SPEC)
SPEC.loader.exec_module(schedule)


def test_day_starts_at_midnight() -> None:
    now = datetime(2026, 9, 15, 18, 30, tzinfo=timezone.utc)
    assert schedule.period_start(now, "day") == datetime(
        2026, 9, 15, tzinfo=timezone.utc
    )


def test_week_starts_on_monday() -> None:
    now = datetime(2026, 9, 17, 18, 30, tzinfo=timezone.utc)
    assert schedule.period_start(now, "week") == datetime(
        2026, 9, 14, tzinfo=timezone.utc
    )


def test_weekday_filter() -> None:
    tuesday = datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc)
    assert schedule.is_available_today({"weekdays": [0, 1, 2, 3, 4]}, tuesday)
    assert not schedule.is_available_today({"weekdays": [0]}, tuesday)

