import { parseEventStart } from "./event-input.js";
import type { SlotSeed } from "./slot-presets.js";

export type ActivityKind = "FLEET" | "GROUND";
export type ScheduleMode = "EVENT_START" | "SPECIFIC_TIME" | "AFTER_GROUP" | "AS_DIRECTED";

export type ActivityRoleSeed = {
  label: string;
  capacity: number;
};

export type ActivityGroupSeed = {
  key: string;
  kind: ActivityKind;
  name: string;
  scheduleMode: ScheduleMode;
  startsAt?: Date;
  timingNote?: string;
  predecessorKey?: string;
  ships: Array<{ name: string; roles: ActivityRoleSeed[] }>;
  roles: ActivityRoleSeed[];
};

const cleanText = (value: unknown, fallback: string, maxLength = 100) => {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
};

const parseRole = (value: unknown, fallback: string): ActivityRoleSeed => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const capacity = Number(record.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 25) {
    throw new Error("Every role capacity must be a whole number from 1 through 25.");
  }

  return {
    label: cleanText(record.label, fallback, 80),
    capacity,
  };
};

export const normalizeActivityGroups = (value: unknown): ActivityGroupSeed[] => {
  if (!Array.isArray(value) || !value.length) {
    throw new Error("Add at least one fleet or ground team.");
  }

  if (value.length > 30) {
    throw new Error("An event can have at most 30 fleets and ground teams.");
  }

  const groups = value.map((item, groupIndex) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const key = cleanText(record.clientId, `group-${groupIndex + 1}`, 80);
    const kind: ActivityKind = record.kind === "GROUND" ? "GROUND" : "FLEET";
    const name = cleanText(record.name, kind === "FLEET" ? `Fleet ${groupIndex + 1}` : `Ground Team ${groupIndex + 1}`);
    const requestedMode = record.scheduleMode;
    const scheduleMode: ScheduleMode =
      requestedMode === "EVENT_START" ||
      requestedMode === "SPECIFIC_TIME" ||
      requestedMode === "AFTER_GROUP"
        ? requestedMode
        : "AS_DIRECTED";
    const predecessorKey =
      scheduleMode === "AFTER_GROUP" ? cleanText(record.predecessorClientId, "", 80) || undefined : undefined;
    const startsAt = scheduleMode === "SPECIFIC_TIME" ? parseEventStart(record.startsAt) : undefined;

    if (scheduleMode === "SPECIFIC_TIME" && !startsAt) {
      throw new Error(`${name} needs a specific start time.`);
    }
    if (scheduleMode === "AFTER_GROUP" && !predecessorKey) {
      throw new Error(`${name} must identify the fleet or ground team it follows.`);
    }

    const ships = kind === "FLEET"
      ? (Array.isArray(record.ships) ? record.ships : []).map((ship, shipIndex) => {
          const shipRecord = ship && typeof ship === "object" ? (ship as Record<string, unknown>) : {};
          const roles = (Array.isArray(shipRecord.roles) ? shipRecord.roles : []).map((role) =>
            parseRole(role, "Crew"),
          );
          if (!roles.length) {
            throw new Error(`${name}, Ship ${shipIndex + 1} needs at least one role.`);
          }
          return {
            name: cleanText(shipRecord.name, `Ship ${shipIndex + 1}`),
            roles,
          };
        })
      : [];
    const roles = kind === "GROUND"
      ? (Array.isArray(record.roles) ? record.roles : []).map((role) => parseRole(role, "Ground Crew"))
      : [];

    if (kind === "FLEET" && !ships.length) {
      throw new Error(`${name} needs at least one ship.`);
    }
    if (kind === "GROUND" && !roles.length) {
      throw new Error(`${name} needs at least one role.`);
    }

    return {
      key,
      kind,
      name,
      scheduleMode,
      startsAt,
      timingNote: cleanText(record.timingNote, "", 200) || undefined,
      predecessorKey,
      ships,
      roles,
    } satisfies ActivityGroupSeed;
  });

  const keys = new Set<string>();
  for (const group of groups) {
    if (keys.has(group.key)) {
      throw new Error("Every fleet and ground team must have a unique internal identifier.");
    }
    keys.add(group.key);
  }

  const byKey = new Map(groups.map((group) => [group.key, group]));
  for (const group of groups) {
    if (group.predecessorKey && !byKey.has(group.predecessorKey)) {
      throw new Error(`${group.name} follows a group that is no longer part of this event.`);
    }
    if (group.predecessorKey === group.key) {
      throw new Error(`${group.name} cannot follow itself.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (group: ActivityGroupSeed) => {
    if (visited.has(group.key)) return;
    if (visiting.has(group.key)) {
      throw new Error("Fleet and ground-team scheduling cannot contain a circular dependency.");
    }
    visiting.add(group.key);
    const predecessor = group.predecessorKey ? byKey.get(group.predecessorKey) : undefined;
    if (predecessor) visit(predecessor);
    visiting.delete(group.key);
    visited.add(group.key);
  };
  groups.forEach(visit);

  return groups;
};

export const activityGroupsFromSlots = (slots: SlotSeed[], hasEventStart = false): ActivityGroupSeed[] => {
  const result: ActivityGroupSeed[] = [];
  const shipSlots = slots.filter((slot) => slot.assignmentGroup === "ship");
  if (shipSlots.length) {
    const ships = new Map<string, ActivityRoleSeed[]>();
    for (const slot of shipSlots) {
      const roles = ships.get(slot.category) ?? [];
      roles.push({ label: slot.label, capacity: slot.capacity });
      ships.set(slot.category, roles);
    }
    result.push({
      key: "fleet-1",
      kind: "FLEET",
      name: "Fleet 1",
      scheduleMode: hasEventStart ? "EVENT_START" : "AS_DIRECTED",
      ships: [...ships].map(([name, roles]) => ({ name, roles })),
      roles: [],
    });
  }

  const groundSlots = slots.filter((slot) => slot.assignmentGroup === "ground");
  const groundTeams = new Map<string, ActivityRoleSeed[]>();
  for (const slot of groundSlots) {
    const roles = groundTeams.get(slot.category) ?? [];
    roles.push({ label: slot.label, capacity: slot.capacity });
    groundTeams.set(slot.category, roles);
  }
  [...groundTeams].forEach(([name, roles], index) => {
    result.push({
      key: `ground-${index + 1}`,
      kind: "GROUND",
      name: name || `Ground Team ${index + 1}`,
      scheduleMode: "AS_DIRECTED",
      ships: [],
      roles,
    });
  });

  return result;
};
