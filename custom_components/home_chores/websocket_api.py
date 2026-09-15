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


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all panel commands once."""
    for command in (
        ws_get_state,
        ws_subscribe,
        ws_add_person,
        ws_remove_person,
        ws_add_chore,
        ws_remove_chore,
        ws_complete,
        ws_adjust_score,
        ws_undo_completion,
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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/add_person",
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=40)),
        vol.Optional("avatar", default=""): vol.All(str, vol.Length(max=2)),
        vol.Optional("color", default="#6c5ce7"): vol.Match(r"^#[0-9a-fA-F]{6}$"),
    }
)
@websocket_api.async_response
async def ws_add_person(hass, connection, msg) -> None:
    """Add a household member."""
    person = await _store(hass).add_person(msg["name"], msg["avatar"], msg["color"])
    connection.send_result(msg["id"], person)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/remove_person",
        vol.Required("person_id"): str,
    }
)
@websocket_api.async_response
async def ws_remove_person(hass, connection, msg) -> None:
    """Remove a household member and their assigned chores."""
    try:
        await _store(hass).remove_person(msg["person_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/add_chore",
        vol.Required("title"): vol.All(str, vol.Length(min=1, max=80)),
        vol.Optional("icon", default="mdi:check-circle-outline"): str,
        vol.Optional("assignee_id"): vol.Any(str, None),
        vol.Required("frequency"): vol.In(["day", "week"]),
        vol.Required("times"): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)),
        vol.Optional("weekdays", default=[]): [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))],
        vol.Required("stars"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
    }
)
@websocket_api.async_response
async def ws_add_chore(hass, connection, msg) -> None:
    """Add a recurring chore."""
    try:
        chore = await _store(hass).add_chore(msg)
        connection.send_result(msg["id"], chore)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/remove_chore",
        vol.Required("chore_id"): str,
    }
)
@websocket_api.async_response
async def ws_remove_chore(hass, connection, msg) -> None:
    """Remove a chore."""
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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/adjust_score",
        vol.Required("person_id"): str,
        vol.Required("delta"): vol.All(vol.Coerce(int), vol.Range(min=-1000, max=1000)),
        vol.Optional("reason", default="Parent adjustment"): vol.All(str, vol.Length(max=120)),
    }
)
@websocket_api.async_response
async def ws_adjust_score(hass, connection, msg) -> None:
    """Apply a parent score correction."""
    try:
        result = await _store(hass).adjust_score(
            msg["person_id"], msg["delta"], msg["reason"]
        )
        connection.send_result(msg["id"], result)
    except ValueError as err:
        _error(connection, msg, err)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "home_chores/undo_completion",
        vol.Required("completion_id"): str,
    }
)
@websocket_api.async_response
async def ws_undo_completion(hass, connection, msg) -> None:
    """Undo a mistaken completion and remove its stars."""
    try:
        await _store(hass).undo_completion(msg["completion_id"])
        connection.send_result(msg["id"])
    except ValueError as err:
        _error(connection, msg, err)
