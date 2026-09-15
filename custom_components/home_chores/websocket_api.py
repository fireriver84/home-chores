"""WebSocket API for the Home Chores panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback

from .const import DOMAIN, EVENT_UPDATED
from .store import ChoreStore


def _store(hass: HomeAssistant) -> ChoreStore:
    return hass.data[DOMAIN]


def _error(connection: websocket_api.ActiveConnection, msg: dict[str, Any], err: ValueError) -> None:
    connection.send_error(msg["id"], "invalid_request", str(err))


def _require_parent(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> bool:
    """Enforce a server-side parent session for every management action."""
    user_id = connection.user.id
    if _store(hass).parent_session_valid(msg["parent_token"], user_id):
        return True
    connection.send_error(msg["id"], "parent_locked", "Parent tools are locked")
    return False


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all panel commands once."""
    for command in (
        ws_get_state,
        ws_subscribe,
        ws_set_parent_pin,
        ws_unlock_parent,
        ws_recover_parent_pin,
        ws_admin_reset_parent_pin,
        ws_change_parent_pin,
        ws_lock_parent,
        ws_add_person,
        ws_remove_person,
        ws_add_chore,
        ws_update_chore,
        ws_move_chore,
        ws_remove_chore,
        ws_complete,
        ws_adjust_score,
        ws_undo_completion,
        ws_undo_chore,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "home_chores/get_state"})
@websocket_api.async_response
async def ws_get_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the complete dashboard state."""
    connection.send_result(msg["id"], _store(hass).snapshot())


@websocket_api.websocket_command({vol.Required("type"): "home_chores/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Push fresh state to every open chore panel after a change."""

    @callback
    def forward_update(event: Event) -> None:
        connection.send_event(msg["id"], _store(hass).snapshot())

    connection.subscriptions[msg["id"]] = hass.bus.async_listen(
        EVENT_UPDATED, forward_update
    )
    connection.send_result(msg["id"])


PIN = vol.All(str, vol.Match(r"^\d{4,8}$"))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/set_parent_pin",
        vol.Required("pin"): PIN,
    }
)
@websocket_api.async_response
async def ws_set_parent_pin(hass, connection, msg) -> None:
    """Set up the first parent PIN; only an HA administrator may do this."""
    try:
        result = await _store(hass).set_parent_pin(msg["pin"], connection.user.id)
        connection.send_result(msg["id"], result)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/unlock_parent",
        vol.Required("pin"): PIN,
    }
)
@websocket_api.async_response
async def ws_unlock_parent(hass, connection, msg) -> None:
    """Unlock parent tools for the current HA user for thirty minutes."""
    try:
        token = await _store(hass).unlock_parent(msg["pin"], connection.user.id)
        connection.send_result(msg["id"], {"parent_token": token})
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/recover_parent_pin",
        vol.Required("recovery_code"): vol.All(str, vol.Length(min=16, max=24)),
        vol.Required("new_pin"): PIN,
    }
)
@websocket_api.async_response
async def ws_recover_parent_pin(hass, connection, msg) -> None:
    """Recover a PIN with the one-time recovery code."""
    try:
        result = await _store(hass).recover_parent_pin(
            msg["recovery_code"], msg["new_pin"], connection.user.id
        )
        connection.send_result(msg["id"], result)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/admin_reset_parent_pin",
        vol.Required("new_pin"): PIN,
    }
)
@websocket_api.async_response
async def ws_admin_reset_parent_pin(hass, connection, msg) -> None:
    """Recover parent security using a Home Assistant administrator account."""
    result = await _store(hass).admin_reset_parent_pin(
        msg["new_pin"], connection.user.id
    )
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/change_parent_pin",
        vol.Required("new_pin"): PIN,
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_change_parent_pin(hass, connection, msg) -> None:
    """Change the PIN from an unlocked parent session."""
    if not _require_parent(hass, connection, msg):
        return
    result = await _store(hass).change_parent_pin(
        msg["new_pin"], connection.user.id
    )
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/lock_parent",
        vol.Required("parent_token"): str,
    }
)
@callback
def ws_lock_parent(hass, connection, msg) -> None:
    """End the current parent session."""
    _store(hass).lock_parent(msg["parent_token"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/add_person",
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=40)),
        vol.Optional("avatar", default=""): vol.All(str, vol.Length(max=2)),
        vol.Optional("color", default="#6c5ce7"): vol.Match(r"^#[0-9a-fA-F]{6}$"),
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_add_person(hass, connection, msg) -> None:
    """Add a household member."""
    if not _require_parent(hass, connection, msg):
        return
    person = await _store(hass).add_person(msg["name"], msg["avatar"], msg["color"])
    connection.send_result(msg["id"], person)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/remove_person",
        vol.Required("person_id"): str,
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_remove_person(hass, connection, msg) -> None:
    """Remove a household member and their assigned chores."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        await _store(hass).remove_person(msg["person_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/add_chore",
        vol.Required("title"): vol.All(str, vol.Length(min=1, max=80)),
        vol.Optional("icon", default="mdi:check-circle-outline"): str,
        vol.Optional("assignee_id"): vol.Any(str, None),
        vol.Optional("assignee_ids"): [vol.Any(str, None)],
        vol.Required("frequency"): vol.In(["day", "week"]),
        vol.Required("times"): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)),
        vol.Optional("weekdays", default=[]): [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))],
        vol.Required("stars"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_add_chore(hass, connection, msg) -> None:
    """Add a recurring chore."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        chores = await _store(hass).add_chore(msg)
        connection.send_result(msg["id"], {"chores": chores})
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/update_chore",
        vol.Required("chore_id"): str,
        vol.Required("title"): vol.All(str, vol.Length(min=1, max=80)),
        vol.Optional("icon", default="mdi:check-circle-outline"): str,
        vol.Optional("assignee_id"): vol.Any(str, None),
        vol.Required("frequency"): vol.In(["day", "week"]),
        vol.Required("times"): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)),
        vol.Optional("weekdays", default=[]): [
            vol.All(vol.Coerce(int), vol.Range(min=0, max=6))
        ],
        vol.Required("stars"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_update_chore(hass, connection, msg) -> None:
    """Edit an existing chore and keep its completion history."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        chore = await _store(hass).update_chore(msg["chore_id"], msg)
        connection.send_result(msg["id"], chore)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/move_chore",
        vol.Required("chore_id"): str,
        vol.Required("direction"): vol.In(["up", "down"]),
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_move_chore(hass, connection, msg) -> None:
    """Move a chore within its current list."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        await _store(hass).move_chore(msg["chore_id"], msg["direction"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/remove_chore",
        vol.Required("chore_id"): str,
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_remove_chore(hass, connection, msg) -> None:
    """Remove a chore."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        await _store(hass).remove_chore(msg["chore_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/complete",
        vol.Required("chore_id"): str,
        vol.Required("person_id"): str,
    }
)
@websocket_api.async_response
async def ws_complete(hass, connection, msg) -> None:
    """Award stars for an available chore."""
    try:
        completion = await _store(hass).complete(msg["chore_id"], msg["person_id"])
        connection.send_result(msg["id"], completion)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/adjust_score",
        vol.Required("person_id"): str,
        vol.Required("delta"): vol.All(vol.Coerce(int), vol.Range(min=-1000, max=1000)),
        vol.Optional("reason", default="Parent adjustment"): vol.All(str, vol.Length(max=120)),
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_adjust_score(hass, connection, msg) -> None:
    """Apply a parent score correction."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        result = await _store(hass).adjust_score(
            msg["person_id"], msg["delta"], msg["reason"]
        )
        connection.send_result(msg["id"], result)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/undo_completion",
        vol.Required("completion_id"): str,
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_undo_completion(hass, connection, msg) -> None:
    """Undo a mistaken completion and remove its stars."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        await _store(hass).undo_completion(msg["completion_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/undo_chore",
        vol.Required("chore_id"): str,
        vol.Required("parent_token"): str,
    }
)
@websocket_api.async_response
async def ws_undo_chore(hass, connection, msg) -> None:
    """Undo the latest current-period completion directly from a chore card."""
    if not _require_parent(hass, connection, msg):
        return
    try:
        await _store(hass).undo_latest_for_chore(msg["chore_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)
