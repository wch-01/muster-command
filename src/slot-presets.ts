export type SlotSeed = {
  category: string;
  assignmentGroup: "ship" | "ground" | "extra";
  label: string;
  capacity: number;
};

export const slotPresets = {
  "combat-op": [
    { category: "Capital ships", assignmentGroup: "ship", label: "Big ship captain", capacity: 2 },
    { category: "Capital ships", assignmentGroup: "ship", label: "Gunner", capacity: 4 },
    { category: "Air wing", assignmentGroup: "ship", label: "Fighter pilot", capacity: 3 },
    { category: "Ground team", assignmentGroup: "ground", label: "Combat heavy", capacity: 2 },
    { category: "Ground team", assignmentGroup: "ground", label: "Combat", capacity: 3 },
    { category: "Ground team", assignmentGroup: "ground", label: "Medic", capacity: 1 },
    { category: "Ground team", assignmentGroup: "ground", label: "Industrialist", capacity: 2 },
  ],
  "ground-team": [
    { category: "Ground team", assignmentGroup: "ground", label: "Combat heavy", capacity: 2 },
    { category: "Ground team", assignmentGroup: "ground", label: "Combat", capacity: 4 },
    { category: "Ground team", assignmentGroup: "ground", label: "Medic", capacity: 2 },
    { category: "Ground team", assignmentGroup: "ground", label: "Tech", capacity: 2 },
    { category: "Ground team", assignmentGroup: "ground", label: "Industrialist", capacity: 2 },
  ],
  "ship-crew": [
    { category: "Ship crew", assignmentGroup: "ship", label: "Captain", capacity: 1 },
    { category: "Ship crew", assignmentGroup: "ship", label: "Pilot", capacity: 1 },
    { category: "Ship crew", assignmentGroup: "ship", label: "Gunner", capacity: 4 },
    { category: "Ship crew", assignmentGroup: "ship", label: "Engineer", capacity: 2 },
    { category: "Escort", assignmentGroup: "ship", label: "Fighter pilot", capacity: 4 },
  ],
} satisfies Record<string, SlotSeed[]>;

export type SlotPresetName = keyof typeof slotPresets;

export const inferAssignmentGroup = (category: string, label: string): SlotSeed["assignmentGroup"] => {
  const text = `${category} ${label}`.toLowerCase();
  if (text.includes("extra")) {
    return "extra";
  }

  return text.includes("ground") ||
    text.includes("medic") ||
    text.includes("industrial") ||
    text.includes("combat") ||
    text.includes("tech")
    ? "ground"
    : "ship";
};

export const parseCustomSlots = (input: string): SlotSeed[] => {
  const parseAssignmentGroup = (value: string | undefined, category: string, label: string) => {
    if (value === "ship" || value === "ground" || value === "extra") {
      return value;
    }

    return inferAssignmentGroup(category, label);
  };

  return input
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [label, capacityText, category = "Custom", assignmentGroup] = part
        .split(":")
        .map((value) => value.trim());
      const capacity = Number.parseInt(capacityText ?? "", 10);

      if (!label || !Number.isInteger(capacity) || capacity < 1 || capacity > 25) {
        throw new Error("Custom slots must look like `Label:2:Category; Other label:4:Category`.");
      }

      return { label, capacity, category, assignmentGroup: parseAssignmentGroup(assignmentGroup, category, label) };
    });
};
