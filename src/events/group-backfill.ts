import { prisma } from "../db.js";

export const ensureActivityGroupBackfill = async () => {
  const events = await prisma.event.findMany({
    where: { slots: { some: { groupId: null, assignmentGroup: { in: ["ship", "ground"] } } } },
    include: { slots: { where: { groupId: null }, orderBy: { sortOrder: "asc" } } },
  });

  for (const event of events) {
    await prisma.$transaction(async (tx) => {
      const shipSlots = event.slots.filter((slot) => slot.assignmentGroup === "ship");
      if (shipSlots.length) {
        const group = await tx.eventGroup.create({
          data: {
            eventId: event.id,
            kind: "FLEET",
            name: "Fleet 1",
            scheduleMode: event.startsAt ? "EVENT_START" : "AS_DIRECTED",
            sortOrder: 0,
          },
        });
        await tx.crewSlot.updateMany({
          where: { id: { in: shipSlots.map((slot) => slot.id) } },
          data: { groupId: group.id },
        });
      }

      const groundSlots = event.slots.filter((slot) => slot.assignmentGroup === "ground");
      const categories = [...new Set(groundSlots.map((slot) => slot.category))];
      for (const [index, category] of categories.entries()) {
        const group = await tx.eventGroup.create({
          data: {
            eventId: event.id,
            kind: "GROUND",
            name: category || `Ground Team ${index + 1}`,
            scheduleMode: "AS_DIRECTED",
            sortOrder: 100 + index,
          },
        });
        await tx.crewSlot.updateMany({
          where: { id: { in: groundSlots.filter((slot) => slot.category === category).map((slot) => slot.id) } },
          data: { groupId: group.id },
        });
      }
    });
  }

  const templates = await prisma.eventTemplate.findMany({
    where: { slots: { some: { groupId: null } } },
    include: { slots: { where: { groupId: null }, orderBy: { sortOrder: "asc" } } },
  });

  for (const template of templates) {
    await prisma.$transaction(async (tx) => {
      const shipSlots = template.slots.filter((slot) => slot.assignmentGroup === "ship");
      if (shipSlots.length) {
        const group = await tx.eventTemplateGroup.create({
          data: {
            templateId: template.id,
            kind: "FLEET",
            name: "Fleet 1",
            scheduleMode: "EVENT_START",
            sortOrder: 0,
          },
        });
        await tx.eventTemplateSlot.updateMany({
          where: { id: { in: shipSlots.map((slot) => slot.id) } },
          data: { groupId: group.id },
        });
      }

      const groundSlots = template.slots.filter((slot) => slot.assignmentGroup === "ground");
      const categories = [...new Set(groundSlots.map((slot) => slot.category))];
      for (const [index, category] of categories.entries()) {
        const group = await tx.eventTemplateGroup.create({
          data: {
            templateId: template.id,
            kind: "GROUND",
            name: category || `Ground Team ${index + 1}`,
            scheduleMode: "AS_DIRECTED",
            sortOrder: 100 + index,
          },
        });
        await tx.eventTemplateSlot.updateMany({
          where: { id: { in: groundSlots.filter((slot) => slot.category === category).map((slot) => slot.id) } },
          data: { groupId: group.id },
        });
      }
    });
  }
};
