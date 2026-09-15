"""Persistent storage and chore operations."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import EVENT_UPDATED, STORAGE_KEY, STORAGE_VERSION
from .schedule import is_available_today, period_start

DEFAULT_DATA: dict[str, Any] = {
    "people": [
        {"id": "ava", "name": "Ava", "avatar": "A", "color": "#6c5ce7", "score": 12},
        {"id": "leo", "name": "Leo", "avatar": "L", "color": "#009688", "score": 8},
        {"id": "mia", "name": "Mia", "avatar": "M", "color": "#e0527d", "score": 5},
    ],
    "chores": [
        {
            "id": "feed-dog",
            "title": "Feed the dog",
            "icon": "mdi:dog-side",
            "assignee_id": None,
            "frequency": "day",
            "times": 2,
            "weekdays": [],
            "stars": 1,
        },
        {
            "id": "vacuum-floors",
            "title": "Vacuum the floors",
            "icon": "mdi:vacuum",
            "assignee_id": None,
            "frequency": "week",
            "times": 1,
            "weekdays": [],
            "stars": 3,
        },
        {
            "id": "ava-homework",
            "title": "Finish homework",
            "icon": "mdi:book-open-page-variant",
            "assignee_id": "ava",
            "frequency": "day",
            "times": 1,
            "weekdays": [0, 1, 2, 3, 4],
            "stars": 2,
        },
        {
            "id": "ava-teeth",
            "title": "Brush teeth",
            "icon": "mdi:toothbrush",
            "assignee_id": "ava",
            "frequency": "day",
            "times": 2,
            "weekdays": [],
            "stars": 1,
        },
        {
            "id": "leo-room",
            "title": "Clean bedroom",
            "icon": "mdi:bed",
            "assignee_id": "leo",
            "frequency": "week",
            "times": 1,
            "weekdays": [],
            "stars": 3,
        },
    ],
    "completions": [],
    "adjustments": [],
}


class ChoreStore:
    """Own the persisted Home Chores state."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = deepcopy(DEFAULT_DATA)

    async def async_load(self) -> None:
        """Load stored state, or create the friendly first-run example."""
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.data = stored
        else:
            await self._store.async_save(self.data)

    async def _save(self, action: str) -> None:
        await self._store.async_save(self.data)
        self.hass.bus.async_fire(EVENT_UPDATED, {"action": action})

    def snapshot(self) -> dict[str, Any]:
        """Return a safe copy ordered newest-first for the frontend."""
        result = deepcopy(self.data)
        result["completions"] = sorted(
            result["completions"], key=lambda item: item["completed_at"], reverse=True
        )[:100]
        result["adjustments"] = sorted(
            result["adjustments"], key=lambda item: item["created_at"], reverse=True
        )[:100]
        return result

    def _person(self, person_id: str) -> dict[str, Any]:
        person = next((p for p in self.data["people"] if p["id"] == person_id), None)
        if person is None:
            raise ValueError("Person not found")
        return person

    def _chore(self, chore_id: str) -> dict[str, Any]:
        chore = next((c for c in self.data["chores"] if c["id"] == chore_id), None)
        if chore is None:
            raise ValueError("Chore not found")
        return chore

    async def add_person(self, name: str, avatar: str, color: str) -> dict[str, Any]:
        person = {
            "id": uuid4().hex,
            "name": name.strip(),
            "avatar": (avatar.strip() or name.strip()[:1]).upper()[:2],
            "color": color,
            "score": 0,
        }
        self.data["people"].append(person)
        await self._save("person_added")
        return person

    async def remove_person(self, person_id: str) -> None:
        self._person(person_id)
        self.data["people"] = [p for p in self.data["people"] if p["id"] != person_id]
        self.data["chores"] = [c for c in self.data["chores"] if c["assignee_id"] != person_id]
        await self._save("person_removed")

    async def add_chore(self, values: dict[str, Any]) -> dict[str, Any]:
        assignee_id = values.get("assignee_id")
        if assignee_id:
            self._person(assignee_id)
        chore = {
            "id": uuid4().hex,
            "title": values["title"].strip(),
            "icon": values.get("icon") or "mdi:check-circle-outline",
            "assignee_id": assignee_id,
            "frequency": values["frequency"],
            "times": values["times"],
            "weekdays": values.get("weekdays", []),
            "stars": values["stars"],
        }
        self.data["chores"].append(chore)
        await self._save("chore_added")
        return chore

    async def remove_chore(self, chore_id: str) -> None:
        self._chore(chore_id)
        self.data["chores"] = [c for c in self.data["chores"] if c["id"] != chore_id]
        await self._save("chore_removed")

    async def complete(self, chore_id: str, person_id: str) -> dict[str, Any]:
        chore = self._chore(chore_id)
        person = self._person(person_id)
        if chore["assignee_id"] and chore["assignee_id"] != person_id:
            raise ValueError("This chore belongs to someone else")

        now = dt_util.now()
        schedule = {"weekdays": chore["weekdays"]}
        if not is_available_today(schedule, now):
            raise ValueError("This chore is not scheduled today")
        start = period_start(now, chore["frequency"])
        count = sum(
            1
            for item in self.data["completions"]
            if item["chore_id"] == chore_id
            and datetime.fromisoformat(item["completed_at"]) >= start
        )
        if count >= chore["times"]:
            raise ValueError("This chore is already complete for this period")

        completion = {
            "id": uuid4().hex,
            "chore_id": chore_id,
            "person_id": person_id,
            "title": chore["title"],
            "stars": chore["stars"],
            "completed_at": now.isoformat(),
        }
        self.data["completions"].append(completion)
        person["score"] += chore["stars"]
        await self._save("chore_completed")
        return completion

    async def adjust_score(self, person_id: str, delta: int, reason: str) -> dict[str, Any]:
        person = self._person(person_id)
        person["score"] = max(0, person["score"] + delta)
        adjustment = {
            "id": uuid4().hex,
            "person_id": person_id,
            "delta": delta,
            "reason": reason.strip() or "Parent adjustment",
            "created_at": dt_util.now().isoformat(),
        }
        self.data["adjustments"].append(adjustment)
        await self._save("score_adjusted")
        return adjustment

    async def undo_completion(self, completion_id: str) -> None:
        completion = next(
            (c for c in self.data["completions"] if c["id"] == completion_id), None
        )
        if completion is None:
            raise ValueError("Completion not found")
        person = self._person(completion["person_id"])
        person["score"] = max(0, person["score"] - completion["stars"])
        self.data["completions"] = [
            c for c in self.data["completions"] if c["id"] != completion_id
        ]
        await self._save("completion_undone")

