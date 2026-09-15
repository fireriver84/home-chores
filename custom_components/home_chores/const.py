"""Constants for Home Chores."""

from typing import Final

DOMAIN: Final = "home_chores"
STORAGE_KEY: Final = DOMAIN
STORAGE_VERSION: Final = 1
PANEL_URL: Final = "home-chores"
PANEL_TITLE: Final = "Chores"
PANEL_ICON: Final = "mdi:star-four-points"
FRONTEND_PATH: Final = "/home_chores/home-chores-panel.js"
EVENT_UPDATED: Final = "home_chores_updated"
DATA_API_REGISTERED: Final = f"{DOMAIN}_api_registered"
