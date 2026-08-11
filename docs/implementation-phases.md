# Muster Command — Implementation Phases

This document captures the planned work based on the client feedback received on August 10, 2026. The phases are listed in their intended implementation order.

## Agreed direction

- Fleets will be named and displayed as accordions.
- Ships and their roles will appear inside each fleet accordion.
- Ground teams will also be displayed as accordions.
- We will use **Ground Teams**, not **Platoons**, in the UI and data model.
- A participant may hold an assignment in more than one fleet or ground team when their schedules permit it.
- Ground-team scheduling may be sequential rather than tied to a clock time.
- Loot pools may contain resources, weapons, armor, components, consumables, or other user-defined items.
- Loot items will eventually support optional quality, quantity, packaging, and configurable award behavior.
- Resource-form rules apply only to resource loot and must not restrict weapons, armor, or other item categories.
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

## Phase 4 — Multiple assignments and schedule conflicts (completed)

1. Replace the current rule of one fleet assignment and one ground assignment per event.
2. Enforce one role per participant within each individual fleet or ground team.
3. Permit a participant to join multiple fleets or ground teams when their schedules do not overlap.
4. Block signup when two joined groups both start at the event start time.
5. Block signup when two joined groups have the same explicit start time.
6. Block signup when two joined groups both start after the same preceding group completes.
7. Treat different steps in the same dependency chain as sequential and therefore non-overlapping.
8. Do not infer a conflict for `As directed` groups because their actual start times are unknown.
9. Show a conflict notice that names the participant's existing conflicting group and disable the conflicting website signup controls.
10. Enforce the same rules in the shared signup service so website and Discord requests cannot bypass them.
11. Do not add an event-owner conflict override. If a real conflict is not represented by these rules, the event schedule should be corrected.
12. Replace broad Leave Fleet/Ground actions with Leave This Fleet or Leave This Ground Team.
13. Retain Leave Event for removing every assignment at once.
14. Serialize assignment changes per participant and final-slot claims at the database level.
15. Add unit and database-backed concurrency tests for the conflict rules and simultaneous final-slot claims.

## Phase 5 — Structured loot, resource rules, quality, and quantity

This phase must support mixed loot pools. Resources are only one category of loot; the same event may also award guns, armor, components, consumables, and miscellaneous items. Resource-specific settings must therefore supplement the general loot system rather than define it.

1. Replace the website's comma-separated loot input with structured loot-item rows.
2. Add a required **Loot category** dropdown to each row. Initial options should include:
   - **Resource or material**;
   - **Weapon**;
   - **Armor**;
   - **Component or equipment**;
   - **Consumable**;
   - **Other**.
3. Keep the item name free-text for every category. Do not create or maintain a predefined catalog of game items or materials.
4. Show fields appropriate to the selected category while retaining these common fields for every item:
   - item or material name;
   - quantity, defaulting to one;
   - optional quality;
   - award method.
5. Always provide **Other** as a flexible escape hatch. Selecting it exposes all supported optional fields so unusual loot can be described without requiring a new category or application update.
6. For **Resource or material**, additionally provide an optional **Unit or package** field. This distinguishes entries such as ten boxes, one mining bag, ten individual gems, or ten units of refined material.
7. Validate quality as a whole number from 1 through 1000. Store `null` when an item has no quality rather than treating zero as a special value. Quality remains optional because it may not apply to every loot category.
8. Require quantity to be a positive whole number but do not impose an application-level maximum.
9. Show a red field outline and a non-blocking warning when resource quantity exceeds 100 or any other category exceeds 10. The warning asks the user to confirm the unusually large quantity but does not prevent submission.
10. Add an event-creation section named **Resource loot rules** with an **Accepted resource forms** selector containing:
   - **Any form**;
   - **Refined materials only**;
   - **Raw resources only**;
   - **No resources**;
   - **Custom rules**.
11. Treat accepted resource forms as organizer guidance, not application-enforced validation. Display the selected policy prominently in the website loot window, Discord loot panel, and structured add-loot interface. Do not require a Raw/Refined field, hide the Resource category, or reject a resource entry based on the selected policy. When an entry appears contrary to guidance such as **No resources**, warn without blocking it.
12. Explain the selector with: `Controls which resources participants should add to the loot pool. This does not affect equipment or other loot.`
13. When **Custom rules** is selected, show a **Resource instructions** field with guidance such as: `Describe accepted resource forms, packaging, quality requirements, or who may claim them.`
14. Add a general **Loot instructions** field to event creation for eligibility, priority, distribution, or other organizer rules that the application does not enforce. Keep this separate from the general event description and display it prominently in the website loot window and Discord loot panel.
15. Add an event-level **How should quantities be awarded?** setting with these choices:
    - **One winner receives the full quantity** — one draw awards the complete entry to one winner;
    - **Draw each unit separately** — the quantity represents the number of awards drawn from the same set of bidders.
16. Default new events to **One winner receives the full quantity**.
17. When individual-unit drawing is selected, show **Can one participant win multiple units of the same item?** with these choices:
    - **Yes, each unit is an independent draw**;
    - **No, distribute to different bidders when possible**.
18. Default individual-unit draws to distributing awards among different bidders when possible. If the quantity exceeds the number of bidders, continue drawing from the eligible bidders only after each bidder has received one unit.
19. Allow each loot item to use the event's award method or explicitly override it with **Full quantity** or **Individual units**. When the effective method is **Individual units**, allow the item to use the event's repeat-winner behavior or override it with **Allow repeat winners** or **Different winners when possible**.
20. Treat an individually awarded quantity as one displayed loot entry with multiple internal awards, not as multiple loot records. This preserves a single bid target and avoids consuming Discord's 25-button limit for repeated units.
21. Before bidding, summarize the category, quality, quantity, packaging, and effective award behavior in plain language. Examples:
    - `Quantanium · Quality 85 · 10 boxes · Awarded separately · Up to one box per bidder`;
    - `Quantanium mining bag · Quantity 1 · Entire entry awarded to one winner`;
    - `FS-9 LMG · Quantity 2 · Awarded separately`.
22. Display the same essential item information on the website, Discord loot panels, bid controls, and result reports where platform limits permit.
23. Add first-class award records. An individual-unit draw creates one award record per unit; a full-quantity draw creates one award record containing the complete quantity. Aggregate award records for display so results identify how many units each winner received. Replace the current single-winner fields rather than maintaining two winner systems.
24. A completed manual draw must mark the pool as drawn, disable further manual draws, and deactivate its scheduled automatic draw. Explicit concurrency protection between a manual and automatic draw is deferred.
25. Allow the event creator and the participant who added a loot item to edit it until the pool is drawn. Preserve existing bids when an item is edited and lock all item editing after the draw.
26. Extend Discord `/loot add` with a documented structured format supporting category, name, quality, quantity, packaging, and item-level award overrides. Retain the existing comma-separated format as shorthand that creates **Other** items with quantity one and event-default award behavior. The website remains the preferred interface for complex entries.
27. Store all event-level loot settings in templates: loot claim window, accepted resource forms, resource instructions, general loot instructions, default award method, and default repeat-winner behavior. Templates configure loot behavior but do not contain actual loot items.
28. Do not migrate existing test loot into the new model. Existing loot data may be reset during development, and the obsolete single-winner fields may be removed.
29. Add tests covering mixed-category pools, guidance-only resource-policy display and warnings, category-specific fields, the fully expanded **Other** entry, quantity warnings, item editing and permissions, bid preservation after edits, full-quantity draws, individual-unit draws with and without repeat winners, quantities larger than the bidder count, items with no bids, manual-draw scheduler deactivation, legacy Discord shorthand, template loot settings, and the development-data reset.

## Confirmed loot decisions

- Quantity semantics are explicit and configurable rather than universal.
- The event supplies the default award method, and an individual loot item may override it.
- The event supplies the default repeat-winner behavior, and an individually awarded loot item may override it.
- Free-text names are used instead of a predefined game-item or material catalog.
- Resource-form rules are guidance only. They are displayed prominently but do not block or validate resource entries.
- Quantity warnings are non-blocking, with thresholds of 100 for resources and 10 for all other categories.
- **Other** is always available and exposes every supported optional field.
- Loot results use first-class award records rather than the old single-winner fields.
- Existing test loot may be discarded rather than migrated.
- The event creator and item creator may edit an item before the pool is drawn without removing its bids.
- The legacy Discord comma-separated add format remains available as shorthand.
- Templates preserve event-level loot settings but do not contain loot items.
