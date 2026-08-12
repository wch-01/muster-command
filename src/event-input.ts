const explicitTimeZonePattern = /(Z|[+-]\d{2}:\d{2})$/i;

export const parseEventStart = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const normalized = value.trim();
  if (!explicitTimeZonePattern.test(normalized)) {
    throw new Error("Event start time must include a timezone.");
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid event start time.");
  }

  return date;
};
