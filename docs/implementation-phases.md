# Muster Command — Implementation Phases

This document captures the planned work based on the client feedback received on August 10, 2026. The phases are listed in their intended implementation order.

## Agreed direction

- Fleets will be named and displayed as accordions.
- Ships and their roles will appear inside each fleet accordion.
- Ground teams will also be displayed as accordions.
- We will use **Ground Teams**, not **Platoons**, in the UI and data model.
- A participant may hold an assignment in more than one fleet or ground team when their schedules permit it.
- Ground-team scheduling may be sequential rather than tied to a clock time.
- Loot items will eventually support optional material quality and quantity.
- Existing events and templates must remain usable after the data-model changes.

## Phase 1 — Time and loot clarity (completed)

1. Show a timezone indicator beside event start-time inputs and displays.
2. Convert browser-local event times to explicit UTC timestamps before submission.
3. Improve loot eligibility messages so users can distinguish:
   - a required event signup;
   - an unavailable Discord server profile;
   - a drawn loot pool.
4. Explain that participants may add loot while the pool is open, including before the event is ended.
5. Verify loot behavior for open events, closed events during the loot window, nonparticipants, and drawn pools.
6. Add focused tests for timezone conversion and loot eligibility.

## Phase 2 — New event model and creation form (completed)

This phase establishes the final event structure before more test events are created or loot data is changed.

1. Add a first-class activity-group model with:
   - type: fleet or ground team;
   - user-defined name;
   - scheduling mode;
   - optional timing note;
   - display order.
2. Support these scheduling modes:
   - **At event start** — begins with the event's scheduled start;
   - **At a specific time** — has its own explicit local time and timezone;
   - **After another group completes** — begins when a selected fleet or ground team finishes its task;
   - **As directed** — intentionally has no calculated start time.
3. For `After another group completes`, store a reference to the preceding group rather than copying its name or time.
4. Support dependency chains such as:
   - Expedition Fleet starts at the event time;
   - Ground Team 1 starts after Expedition Fleet completes;
   - Ground Team 2 starts after Ground Team 1 completes.
5. Prevent self-dependencies and circular dependency chains.
6. Treat dependency timing as an operational sequence, not a calculated clock time. A duration is not required merely to say one group follows another.
7. Attach each ship to a named fleet.
8. Attach each set of ground roles to a named ground team.
9. Replace the flattened `customSlots` website submission with a structured event payload containing groups, ships, roles, schedules, and dependencies.
10. Update event creation so organizers can add, name, schedule, and remove fleets and ground teams. Creation order is the intended display and operational order.
11. Show the resulting sequence and dependency chain in the creation-form preview before saving.
12. Update templates to preserve the same hierarchy and scheduling information.
13. Migrate existing events and templates into one default Fleet and their existing named Ground Teams.
14. Mark migrated schedules as `As directed` unless an existing event start can safely be assigned to the default Fleet. Do not invent ground-team dependencies for historical data.
15. Preserve existing event history, assignments, loot, and reports during migration.
16. Keep an API compatibility adapter for Discord slash-command event creation until Discord can submit the structured model directly.

## Phase 3 — Accordion event page (completed)

This phase uses the new activity-group model created in Phase 2.

1. Replace the flat Fleet, Ground, and Extra columns with a hierarchical accordion layout.
2. Display each named fleet as a top-level accordion.
3. Display ships as nested accordions inside their fleet.
4. Display ship roles and assignments inside an expanded ship.
5. Display each ground team as its own top-level accordion.
6. Show useful summaries on collapsed accordions:
   - scheduled time or sequence, such as `After Expedition Fleet`;
   - assigned and total capacity;
   - whether the current user is assigned.
7. Add per-fleet and per-ground-team leave controls.
8. Keep Extra Crew separate and preserve its locked state until regular roles are filled.
9. Adapt Discord embeds to retain fleet, ship, ground-team, and sequence information within Discord's layout limits.
10. Update event-list accordions to summarize named fleets and ground teams with compact filled/open slot totals instead of individual assignments.

Reference mockup: [Event page accordion mockup](event-page-accordion-mockup.png)

## Phase 4 — Multiple assignments and schedule conflicts (next)

1. Replace the current rule of one fleet assignment and one ground assignment per event.
2. Enforce one role per participant within each individual fleet or ground team.
3. Permit a participant to join multiple fleets or ground teams when their schedules do not overlap.
4. Treat groups in the same dependency chain as sequential and therefore non-overlapping.
5. Detect definite overlap only when enough explicit timing information is available.
6. For parallel or `As directed` groups whose overlap cannot be calculated, show a scheduling caution rather than blocking signup.
7. Show a warning that names the potentially conflicting group and existing assignment.
8. Initially warn rather than silently replacing an existing assignment.
9. Decide whether event owners should receive an explicit conflict override.
10. Replace broad Leave Fleet/Ground actions with Leave This Fleet or Leave This Ground Team.
11. Retain Leave Event for removing every assignment at once.
12. Add concurrency tests to ensure two users cannot claim the final slot simultaneously.

## Phase 5 — Loot quality and quantity

1. Add an optional quality value to each loot item.
2. Validate quality as a whole number from 1 through 1000.
3. Use `null` when an item has no quality rather than treating zero as a special value.
4. Add quantity to loot items, defaulting to one.
5. Replace the website's comma-separated loot input with structured item rows containing:
   - material or item name;
   - optional quality;
   - quantity.
6. Confirm whether quantity represents independently awarded units or one stack awarded to one winner.
7. Display quality and quantity on the website, Discord loot panels, and result reports where space permits.
8. Extend the Discord `/loot add` workflow with a documented structured format.
9. Migrate existing loot items to no quality and a quantity of one.

## Decisions still to confirm

- Whether a loot quantity represents independently awarded units or one stack awarded to one winner.
- Whether schedule conflicts should only warn or prevent normal users from signing up.
- Whether event owners may override a schedule conflict.
