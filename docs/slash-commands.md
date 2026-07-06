# Slash Command Reference

Production servers need global slash commands registered by the bot owner. The admin setup page can register commands to a test server for fast updates or globally for public servers.

## Event Signups

### `/event create`

Creates an event signup board with buttons.

Useful test values:

- `name`: `Combat Op Test`
- `preset`: `Combat op`
- `loot_timelimit`: `24 hours` or `48 hours`
- `starts_at`: `2026-07-10 20:00 UTC`
- `report_channel`: optional

Preset options:

- `Combat op`: ship roles plus ground roles
- `Ground team`: ground roles only
- `Ship crew`: ship roles only
- `Custom`: use the `custom_slots` field

Custom slot format:

```text
Fighter:3:Air wing; Gunner:4:Capital ships; Medic:1:Ground team
```

Members can hold one ship-side signup and one ground-side signup in the same event. Creating an event also creates its hidden loot pool.

### `/event list`

Shows open events for the server.

### `/event end`

Ends an event, posts an attendance report, and starts the loot timer.

Required:

- `event_id`: copied from the event signup board

## Loot Rolls

### `/loot add`

Adds items to an event loot pool and updates the original loot-pool message.

Required:

- `event_id`: copied from the event signup board
- `items`: comma-separated items, such as `Railgun, Armor Set, Ship Component`

Only event participants can add loot items. Use this when different participants picked up loot and need to add items to the same shared pool.

### `/loot draw`

Draws loot winners immediately.

Required:

- `event_id`: copied from the event signup board

### `/loot show`

Posts a fresh current loot pool and bid panel without adding an item.

Required:

- `event_id`: copied from the event signup board
