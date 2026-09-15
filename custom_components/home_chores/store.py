"""Persistent storage and chore operations."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import secrets
import time
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import EVENT_UPDATED, STORAGE_KEY, STORAGE_VERSION
from .schedule import is_available_today, period_start
from .security import hash_secret, new_recovery_code, new_salt, verify_secret

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
    "parent_security": {
        "pin_hash": None,
        "pin_salt": None,
        "recovery_hash": None,
        "recovery_salt": None,
    },
}


class ChoreStore:
    """Own the persisted Home Chores state."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = deepcopy(DEFAULT_DATA)
        self._parent_sessions: dict[str, tuple[str, float]] = {}
        self._failed_unlocks: dict[str, tuple[int, float]] = {}

    async def async_load(self) -> None:
        """Load stored state, or create the friendly first-run example."""
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.data = stored
            for key, value in DEFAULT_DATA.items():
                self.data.setdefault(key, deepcopy(value))
        else:
            await self._store.async_save(self.data)

    async def _save(self, action: str) -> None:
        await self._store.async_save(self.data)
        self.hass.bus.async_fire(EVENT_UPDATED, {"action": action})

    def snapshot(self) -> dict[str, Any]:
        """Return a safe copy ordered newest-first for the frontend."""
        result = deepcopy(self.data)
        security = result.pop("parent_security", {})
        result["parent_security"] = {"configured": bool(security.get("pin_hash"))}
        result["completions"] = sorted(
            result["completions"], key=lambda item: item["completed_at"], reverse=True
        )[:100]
        result["adjustments"] = sorted(
            result["adjustments"], key=lambda item: item["created_at"], reverse=True
        )[:100]
        return result

    def parent_session_valid(self, token: str, user_id: str) -> bool:
        """Check that a parent session belongs to this HA user and is unexpired."""
        session = self._parent_sessions.get(token)
        if session is None:
            return False
        owner, expires_at = session
        if owner != user_id or expires_at <= time.monotonic():
            self._parent_sessions.pop(token, None)
            return False
        return True

    async def _set_parent_secrets(self, pin: str) -> tuple[str, str]:
        """Persist a PIN and rotate the recovery code, returning both code and session."""
        recovery_code = new_recovery_code()
        pin_salt = new_salt()
        recovery_salt = new_salt()
        pin_hash, recovery_hash = await self.hass.async_add_executor_job(
            lambda: (
                hash_secret(pin, pin_salt),
                hash_secret(recovery_code, recovery_salt),
            )
        )
        self.data["parent_security"] = {
            "pin_hash": pin_hash,
            "pin_salt": pin_salt,
            "recovery_hash": recovery_hash,
            "recovery_salt": recovery_salt,
        }
        self._parent_sessions.clear()
        await self._save("parent_pin_changed")
        return recovery_code, pin_hash

    def _new_parent_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        self._parent_sessions[token] = (user_id, time.monotonic() + 30 * 60)
        return token

    async def set_parent_pin(self, pin: str, user_id: str) -> dict[str, str]:
        """Create parent security for the first time."""
        if self.data["parent_security"].get("pin_hash"):
            raise ValueError("A parent PIN is already configured")
        recovery_code, _ = await self._set_parent_secrets(pin)
        return {
            "parent_token": self._new_parent_session(user_id),
            "recovery_code": recovery_code,
        }

    async def unlock_parent(self, pin: str, user_id: str) -> str:
        """Verify a PIN and issue a short-lived, user-bound parent session."""
        failed_count, blocked_until = self._failed_unlocks.get(user_id, (0, 0.0))
        now = time.monotonic()
        if blocked_until > now:
            raise ValueError("Too many attempts. Try again in five minutes")

        security = self.data["parent_security"]
        if not security.get("pin_hash"):
            raise ValueError("A parent PIN has not been configured")
        valid = await self.hass.async_add_executor_job(
            verify_secret, pin, security["pin_salt"], security["pin_hash"]
        )
        if not valid:
            failed_count += 1
            self._failed_unlocks[user_id] = (
                failed_count,
                now + 300 if failed_count >= 5 else 0.0,
            )
            raise ValueError("Incorrect PIN")
        self._failed_unlocks.pop(user_id, None)
        return self._new_parent_session(user_id)

    async def recover_parent_pin(
        self, recovery_code: str, new_pin: str, user_id: str
    ) -> dict[str, str]:
        """Replace a forgotten PIN using the one-time recovery code."""
        security = self.data["parent_security"]
        if not security.get("recovery_hash"):
            raise ValueError("No recovery code is configured")
        valid = await self.hass.async_add_executor_job(
            verify_secret,
            recovery_code.upper().strip(),
            security["recovery_salt"],
            security["recovery_hash"],
        )
        if not valid:
            raise ValueError("Recovery code is not valid")
        next_code, _ = await self._set_parent_secrets(new_pin)
        return {
            "parent_token": self._new_parent_session(user_id),
            "recovery_code": next_code,
        }

    async def admin_reset_parent_pin(self, pin: str, user_id: str) -> dict[str, str]:
        """Let an authenticated HA administrator recover a lost code."""
        recovery_code, _ = await self._set_parent_secrets(pin)
        return {
            "parent_token": self._new_parent_session(user_id),
            "recovery_code": recovery_code,
        }

    async def change_parent_pin(self, pin: str, user_id: str) -> dict[str, str]:
        """Change an unlocked parent PIN and rotate the recovery code."""
        recovery_code, _ = await self._set_parent_secrets(pin)
        return {
            "parent_token": self._new_parent_session(user_id),
            "recovery_code": recovery_code,
        }

    def lock_parent(self, token: str) -> None:
        """Invalidate a parent session."""
        self._parent_sessions.pop(token, None)

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

    async def update_chore(self, chore_id: str, values: dict[str, Any]) -> dict[str, Any]:
        """Update every editable chore property without changing its history."""
        chore = self._chore(chore_id)
        assignee_id = values.get("assignee_id")
        if assignee_id:
            self._person(assignee_id)
        chore.update(
            {
                "title": values["title"].strip(),
                "icon": values.get("icon") or "mdi:check-circle-outline",
                "assignee_id": assignee_id,
                "frequency": values["frequency"],
                "times": values["times"],
                "weekdays": values.get("weekdays", []),
                "stars": values["stars"],
            }
        )
        await self._save("chore_updated")
        return chore

    async def remove_chore(self, chore_id: str) -> None:
        self._chore(chore_id)
        self.data["chores"] = [c for c in self.data["chores"] if c["id"] != chore_id]
        await self._save("chore_removed")

    async def move_chore(self, chore_id: str, direction: str) -> None:
        """Move a chore one place within its shared or personal list."""
        chore = self._chore(chore_id)
        peers = [
            item
            for item in self.data["chores"]
            if item.get("assignee_id") == chore.get("assignee_id")
        ]
        index = peers.index(chore)
        target_index = index - 1 if direction == "up" else index + 1
        if target_index < 0 or target_index >= len(peers):
            raise ValueError("Chore is already at the edge of this list")
        other = peers[target_index]
        chore_index = self.data["chores"].index(chore)
        other_index = self.data["chores"].index(other)
        self.data["chores"][chore_index], self.data["chores"][other_index] = (
            self.data["chores"][other_index],
            self.data["chores"][chore_index],
        )
        await self._save("chore_reordered")

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

    async def undo_latest_for_chore(self, chore_id: str) -> None:
        """Undo the newest completion in the active period for a chore."""
        chore = self._chore(chore_id)
        start = period_start(dt_util.now(), chore["frequency"])
        matching = [
            item
            for item in self.data["completions"]
            if item["chore_id"] == chore_id
            and datetime.fromisoformat(item["completed_at"]) >= start
        ]
        if not matching:
            raise ValueError("This chore has no current completion to undo")
        latest = max(matching, key=lambda item: item["completed_at"])
        await self.undo_completion(latest["id"])
