import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from "discord.js";
import type { CrewAssignment, CrewSlot, Event } from "@prisma/client";
import { eventCopyId, eventJoinId, eventLeaveId } from "../custom-ids.js";

type EventWithSlots = Event & {
  slots: Array<CrewSlot & { assignments: CrewAssignment[] }>;
};

const formatUsers = (assignments: CrewAssignment[], capacity: number) => {
  const names = assignments.map((assignment) => assignment.discordTag);
  const empty = Array.from({ length: Math.max(capacity - names.length, 0) }, (_, index) => {
    return `Open ${index + 1}`;
  });

  return [...names, ...empty].join("\n");
};

export const eventEmbed = (event: EventWithSlots) => {
  const fields: APIEmbedField[] = event.slots.map((slot) => ({
    name: `${slot.category} - ${slot.label} (${slot.assignments.length}/${slot.capacity})`,
    value: formatUsers(slot.assignments, slot.capacity),
    inline: true,
  }));

  return new EmbedBuilder()
    .setTitle(event.name)
    .setDescription(
      [
        `Event ID: \`${event.id}\``,
        event.startsAt ? `Starts: <t:${Math.floor(event.startsAt.getTime() / 1000)}:F>` : null,
        `Status: ${event.status}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .setColor(event.status === "OPEN" ? 0x2f8f6f : 0x6b7280)
    .addFields(fields)
    .setTimestamp(event.updatedAt);
};

export const eventComponents = (event: EventWithSlots) => {
  const buttons = event.slots.slice(0, 23).map((slot) => {
    const isFull = slot.assignments.length >= slot.capacity;

    return new ButtonBuilder()
      .setCustomId(eventJoinId(slot.id))
      .setLabel(slot.label.slice(0, 80))
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(event.status !== "OPEN" || isFull);
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
      event.slots.map((slot) => ({
        name: `${slot.category} - ${slot.label}`,
        value:
          slot.assignments.map((assignment) => assignment.discordTag).join("\n") ||
          "No one assigned.",
        inline: true,
      })),
    )
    .setTimestamp();
};
