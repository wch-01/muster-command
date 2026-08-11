export const localDateTimeToIso = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Enter a valid event start time.");
  }

  return date.toISOString();
};

export const browserTimeZoneLabel = (date = new Date()) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  const offsetPart = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  return offsetPart ? `${timeZone} (${offsetPart})` : timeZone;
};

export const isoToLocalDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
