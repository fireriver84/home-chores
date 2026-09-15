"""Home Chores integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    DATA_API_REGISTERED,
    DOMAIN,
    FRONTEND_PATH,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
)
from .store import ChoreStore
from .websocket_api import async_register_commands


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Home Chores from a config entry."""
    store = ChoreStore(hass)
    await store.async_load()
    hass.data[DOMAIN] = store

    if not hass.data.get(DATA_API_REGISTERED):
        async_register_commands(hass)
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig("/home_chores", str(frontend_dir), cache_headers=False)]
        )
        hass.data[DATA_API_REGISTERED] = True
    if not frontend.async_panel_exists(hass, PANEL_URL):
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path=PANEL_URL,
            webcomponent_name="home-chores-panel",
            module_url=FRONTEND_PATH,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            require_admin=False,
            embed_iframe=False,
            handle_safe_area=True,
        )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Home Chores."""
    frontend.async_remove_panel(hass, PANEL_URL)
    hass.data.pop(DOMAIN, None)
    return True
