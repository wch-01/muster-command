export type SchedulableGroup = {
  id: string;
  name: string;
  scheduleMode: string;
  startsAt: Date | string | null;
  predecessorGroupId: string | null;
};

const sameSpecificTime = (left: SchedulableGroup, right: SchedulableGroup) => {
  if (!left.startsAt || !right.startsAt) return false;
  return new Date(left.startsAt).getTime() === new Date(right.startsAt).getTime();
};

export const groupsConflict = (left: SchedulableGroup, right: SchedulableGroup) => {
  if (left.id === right.id || left.scheduleMode === "AS_DIRECTED" || right.scheduleMode === "AS_DIRECTED") {
    return false;
  }
  if (left.scheduleMode === "EVENT_START" && right.scheduleMode === "EVENT_START") return true;
  if (left.scheduleMode === "SPECIFIC_TIME" && right.scheduleMode === "SPECIFIC_TIME") {
    return sameSpecificTime(left, right);
  }
  if (left.scheduleMode === "AFTER_GROUP" && right.scheduleMode === "AFTER_GROUP") {
    return Boolean(left.predecessorGroupId && left.predecessorGroupId === right.predecessorGroupId);
  }
  return false;
};

export const findScheduleConflict = (
  candidate: SchedulableGroup,
  assignedGroups: SchedulableGroup[],
) => assignedGroups.find((assigned) => groupsConflict(candidate, assigned));

export const scheduleConflictMessage = (conflictingGroup: SchedulableGroup) =>
  `Schedule conflict: this group starts at the same operational time as ${conflictingGroup.name}.`;
