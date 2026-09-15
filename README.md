# Home Chores for Home Assistant

Home Chores is a Home Assistant-native family chore board. It installs as a custom integration, adds a **Chores** item to the Home Assistant sidebar, inherits the current Home Assistant theme, and stores its data in Home Assistant's `.storage` directory.

## What it includes

- **Up for grabs** chores that ask who completed the task before awarding stars.
- A personal chore list for every household member.
- Daily or weekly recurrence, multiple occurrences per period, and optional weekday limits.
- Configurable star values and a full-screen star burst on completion.
- Parent tools for adding/removing people and chores, correcting star totals, reviewing activity, and undoing false completions.
- Edit every chore field after creation, including its name, owner, icon, recurrence, occurrence limit, weekdays, and stars.
- Unmark the latest completion directly from its chore card, immediately returning the chore to available status and removing its stars.
- Server-enforced parent PIN sessions with lockout protection, a one-time recovery code, and Home Assistant administrator recovery.
- Live updates across open Home Assistant dashboards.
- Friendly starter data demonstrating dog feeding, vacuuming, homework, teeth brushing, and room cleaning.

The future behaviour system can use the same person IDs and activity model, but it is intentionally not part of this first chore-focused version.

## Install manually

1. Copy `custom_components/home_chores` into the `custom_components` directory inside your Home Assistant configuration directory.
2. Restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration**.
4. Search for **Home Chores** and add it.
5. Open **Chores** from the Home Assistant sidebar.

If Home Assistant does not find the integration, clear the browser cache after restarting and confirm the folder is exactly `custom_components/home_chores`.

## Install with HACS during development

Add this repository as a custom repository in HACS using the **Integration** category, install **Home Chores**, restart Home Assistant, and add the integration from **Settings → Devices & services**.

### Important: use HACS, not the Apps store

Do **not** add this URL under **Settings → Apps → Install app → Repositories**. That screen accepts container apps (formerly called add-ons) and will report that this project “is not a valid app repository.” Home Chores is a custom integration, not a container app.

Instead:

1. Open **HACS** from the Home Assistant sidebar.
2. Open the menu in the top-right and choose **Custom repositories**.
3. Enter `https://github.com/fireriver84/home-chores`.
4. Select **Integration** as the category and add it.
5. Find **Home Chores** in HACS and download it.
6. Restart Home Assistant, then add **Home Chores** from **Settings → Devices & services → Add integration**.

## Permissions and data

Any signed-in Home Assistant user can view the board and complete a chore. The first parent PIN must be created by a Home Assistant administrator. After that, any signed-in household account can unlock parent tools with the PIN for a 30-minute session. Management actions are checked against that server-side session rather than protected only by a visual toggle.

When the PIN is created or changed, Home Chores shows a new one-time recovery code. Save it in a password manager. A valid recovery code can replace a forgotten PIN and is rotated after use. If both PIN and recovery code are lost, a signed-in Home Assistant administrator can use the final recovery option.

Data is stored locally by Home Assistant in `.storage/home_chores`. No cloud service or separate database is used.

## Development layout

```text
custom_components/home_chores/
├── __init__.py              # integration and sidebar panel registration
├── config_flow.py           # UI setup flow
├── store.py                 # durable people, chores, stars, and activity
├── websocket_api.py         # authenticated frontend API
├── schedule.py              # recurrence calculations
└── frontend/
    └── home-chores-panel.js # responsive Home Assistant panel
```

## Recurrence behaviour

- A daily chore resets at local midnight.
- A weekly chore resets Monday at local midnight.
- `Times` controls how many completions are available in that period.
- Selecting weekdays makes the chore available only on those days. This supports routines such as homework on weekdays while leaving a twice-daily tooth-brushing task active every day.
