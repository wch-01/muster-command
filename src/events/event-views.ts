import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from "discord.js";
import type { CrewAssignment, CrewSlot, Event, EventGroup } from "@prisma/client";
import { eventCopyId, eventJoinId, eventLeaveId } from "../custom-ids.js";

type EventWithSlots = Event & {
  groups: EventGroup[];
  slots: Array<CrewSlot & { assignments: CrewAssignment[] }>;
};

const clip = (value: string, limit: number) => value.length <= limit
  ? value
  : `${value.slice(0, Math.max(limit - 1, 0))}…`;

const scheduleText = (event: EventWithSlots, group: EventGroup) => {
  if (group.scheduleMode === "EVENT_START") return "At event start";
  if (group.scheduleMode === "SPECIFIC_TIME" && group.startsAt) {
    return `<t:${Math.floor(group.startsAt.getTime() / 1000)}:F>`;
  }
  if (group.scheduleMode === "AFTER_GROUP") {
    const predecessor = event.groups.find((candidate) => candidate.id === group.predecessorGroupId);
    return predecessor ? `After ${predecessor.name}` : "After another group";
  }
  return group.timingNote || "As directed";
};

const roleLine = (slot: EventWithSlots["slots"][number], showOpen: boolean) => {
  const assigned = slot.assignments.map((assignment) => assignment.discordTag);
  const openCount = Math.max(slot.capacity - assigned.length, 0);
  const people = [
    ...assigned,
    ...(showOpen && openCount ? [`Open ×${openCount}`] : []),
  ];
  return `**${slot.label}** (${slot.assignments.length}/${slot.capacity}): ${people.join(", ") || "No one assigned"}`;
};

const structuredFields = (event: EventWithSlots, showOpen: boolean): APIEmbedField[] => {
  const fields: APIEmbedField[] = [];
  for (const group of event.groups) {
    const slots = event.slots.filter((slot) => slot.groupId === group.id);
    if (group.kind === "FLEET") {
      const ships = [...new Set(slots.map((slot) => slot.category))];
      for (const ship of ships) {
        const shipSlots = slots.filter((slot) => slot.category === ship);
        const value = [
          `*${scheduleText(event, group)}*`,
          group.timingNote && group.scheduleMode !== "AS_DIRECTED" ? group.timingNote : null,
          ...shipSlots.map((slot) => roleLine(slot, showOpen)),
        ].filter(Boolean).join("\n");
        fields.push({
          name: clip(`${group.name} › ${ship}`, 256),
          value: clip(value || "No roles listed.", 1024),
          inline: false,
        });
      }
    } else {
      const value = [
        `*${scheduleText(event, group)}*`,
        group.timingNote && group.scheduleMode !== "AS_DIRECTED" ? group.timingNote : null,
        ...slots.map((slot) => roleLine(slot, showOpen)),
      ].filter(Boolean).join("\n");
      fields.push({ name: clip(group.name, 256), value: clip(value || "No roles listed.", 1024), inline: false });
    }
  }

  const extras = event.slots.filter((slot) => slot.assignmentGroup === "extra");
  if (extras.length) {
    fields.push({
      name: "Extra Crew",
      value: clip(extras.map((slot) => roleLine(slot, showOpen)).join("\n"), 1024),
      inline: false,
    });
  }

  if (fields.length <= 25) return fields;
  return [
    ...fields.slice(0, 24),
    { name: "Additional assignments", value: `${fields.length - 24} more ship or team sections are available on the website.`, inline: false },
  ];
};

export const eventEmbed = (event: EventWithSlots) => {
  const fields = structuredFields(event, true);

  const embed = new EmbedBuilder()
    .setTitle(event.name)
    .setDescription(
      [
        `Event ID: \`${event.id}\``,
        event.startsAt ? `Starts: <t:${Math.floor(event.startsAt.getTime() / 1000)}:F>` : null,
        event.description,
        `Status: ${event.status}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .setColor(event.status === "OPEN" ? 0x2f8f6f : 0x6b7280)
    .addFields(fields)
    .setTimestamp(event.updatedAt);

  if (event.logoUrl) {
    embed.setThumbnail(event.logoUrl);
  }

  return embed;
};

export const eventComponents = (event: EventWithSlots) => {
  const regularSlots = event.slots.filter((slot) => slot.assignmentGroup !== "extra");
  const regularSlotsFull =
    regularSlots.length > 0 &&
    regularSlots.every((slot) => slot.assignments.length >= slot.capacity);

  const buttons = event.slots.slice(0, 23).map((slot) => {
    const isFull = slot.assignments.length >= slot.capacity;
    const isExtraLocked = slot.assignmentGroup === "extra" && !regularSlotsFull;

    const group = event.groups.find((candidate) => candidate.id === slot.groupId);
    const context = slot.assignmentGroup === "ship" ? slot.category : group?.name ?? slot.category;
    return new ButtonBuilder()
      .setCustomId(eventJoinId(slot.id))
      .setLabel(`${context}: ${slot.label}`.slice(0, 80))
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(event.status !== "OPEN" || isFull || isExtraLocked);
  });

  buttons.push(
    new ButtonBuilder()
      .setCustomId(eventCopyId(event.id))
      .setLabel("Copy event ID")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(eventLeaveId(event.id))
      .setLabel("Leave event")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(event.status !== "OPEN"),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
};

export const eventReportEmbed = (event: EventWithSlots) => {
  const participants = new Set(
    event.slots.flatMap((slot) => slot.assignments.map((assignment) => assignment.discordTag)),
  );

  return new EmbedBuilder()
    .setTitle(`Attendance report: ${event.name}`)
    .setDescription(
      [`Event ID: \`${event.id}\``, `Participants: ${participants.size}`].join("\n"),
    )
    .setColor(0x3b82f6)
    .addFields(
      structuredFields(event, false),
    )
    .setTimestamp();
};
