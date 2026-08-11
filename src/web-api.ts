import type { IncomingMessage, ServerResponse } from "node:http";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { createEvent, endEvent, eventInclude } from "./events/event-service.js";
import { addLootItems, drawRaffleByEventId, lootInclude } from "./loot/loot-service.js";
import { type SlotPresetName, slotPresets, type SlotSeed } from "./slot-presets.js";
import type { AuthenticatedUser } from "./auth.js";
import { notifyEventsChanged } from "./event-stream.js";
import { botGuildTextChannels, publishEventPanel, publishLootPanel } from "./bot-runtime.js";
import { parseEventStart } from "./event-input.js";
import { lootEligibility } from "./loot/loot-eligibility.js";
import {
  activityGroupsFromSlots,
  normalizeActivityGroups,
  type ActivityGroupSeed,
} from "./event-groups.js";

const json = (response: ServerResponse, statusCode: number, data: unknown) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
};

const jsonAndNotifyEventsChanged = (response: ServerResponse, statusCode: number, data: unknown) => {
  json(response, statusCode, data);
  setImmediate(notifyEventsChanged);
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 250_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
};

const parseItems = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const defaultCombatOpTemplate: SlotSeed[] = [
  { category: "Capital ship 1", assignmentGroup: "ship", label: "Big ship captain", capacity: 1 },
  { category: "Capital ship 1", assignmentGroup: "ship", label: "Gunner", capacity: 2 },
  { category: "Capital ship 1", assignmentGroup: "ship", label: "Fighter pilot", capacity: 2 },
  { category: "Ground team 1", assignmentGroup: "ground", label: "Combat heavy", capacity: 1 },
  { category: "Ground team 1", assignmentGroup: "ground", label: "Combat", capacity: 3 },
  { category: "Ground team 1", assignmentGroup: "ground", label: "Medic", capacity: 1 },
  { category: "Ground team 1", assignmentGroup: "ground", label: "Industrialist", capacity: 1 },
];

const templateInclude = {
  groups: { orderBy: { sortOrder: "asc" } },
  slots: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.EventTemplateInclude;

const writeTemplateGroups = async (
  tx: Prisma.TransactionClient,
  templateId: string,
  groups: ActivityGroupSeed[],
) => {
  const createdGroups = new Map<string, string>();
  let slotOrder = 0;
  for (const [groupIndex, group] of groups.entries()) {
    const createdGroup = await tx.eventTemplateGroup.create({
      data: {
        templateId,
        kind: group.kind,
        name: group.name,
        scheduleMode: group.scheduleMode,
        startsAt: group.startsAt,
        timingNote: group.timingNote,
        sortOrder: groupIndex,
      },
    });
    createdGroups.set(group.key, createdGroup.id);
    const roles = group.kind === "FLEET"
      ? group.ships.flatMap((ship) => ship.roles.map((role) => ({ ...role, category: ship.name })))
      : group.roles.map((role) => ({ ...role, category: group.name }));
    for (const role of roles) {
      await tx.eventTemplateSlot.create({
        data: {
          templateId,
          groupId: createdGroup.id,
          category: role.category,
          assignmentGroup: group.kind === "FLEET" ? "ship" : "ground",
          label: role.label,
          capacity: role.capacity,
          sortOrder: slotOrder++,
        },
      });
    }
  }
  for (const group of groups) {
    if (!group.predecessorKey) continue;
    await tx.eventTemplateGroup.update({
      where: { id: createdGroups.get(group.key)! },
      data: { predecessorGroupId: createdGroups.get(group.predecessorKey) },
    });
  }
};

const normalizeTemplateSlots = (value: unknown): SlotSeed[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((slot) => {
      const record = slot as Record<string, unknown>;
      const category = typeof record.category === "string" ? record.category.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const assignmentGroup = record.assignmentGroup === "ground" ? "ground" : record.assignmentGroup === "ship" ? "ship" : undefined;
      const capacity = Number(record.capacity);

      if (!category || !label || !assignmentGroup || !Number.isInteger(capacity) || capacity < 1) {
        return undefined;
      }

      return {
        category,
        assignmentGroup,
        label,
        capacity: Math.min(capacity, 25),
      };
    })
    .filter((slot): slot is SlotSeed => Boolean(slot));
};

const ensureDefaultTemplate = async (guildId: string) => {
  const templateCount = await prisma.eventTemplate.count({ where: { guildId } });
  if (templateCount > 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const template = await tx.eventTemplate.create({ data: {
      guildId,
      createdById: "system",
      createdByName: "Muster Command",
      name: "Combat Op",
      isDefault: true,
    } });
    await writeTemplateGroups(tx, template.id, activityGroupsFromSlots(defaultCombatOpTemplate, true));
  });
};

const eventDetails = async (
  eventId: string,
  context: { userId?: string; hasActiveGuildProfile?: boolean } = {},
) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      ...eventInclude,
      raffles: {
        orderBy: { createdAt: "asc" },
        include: lootInclude,
      },
    },
  });

  if (!event) {
    return null;
  }

  const members = (event.slots || []).flatMap((slot) =>
    (slot.assignments || []).map((assignment) => ({
      id: assignment.discordUserId,
      name: assignment.discordTag,
      slot: slot.label,
      group: slot.assignmentGroup,
      hasBid: (event.raffles || []).some((raffle) =>
        (raffle.items || []).some((item) =>
          (item.bids || []).some((bid) => bid.discordUserId === assignment.discordUserId),
        ),
      ),
    })),
  );

  const isOwner = Boolean(context.userId && event.createdById === context.userId);
  const participantIds = new Set(members.map((member) => member.id));
  const myAssignmentGroups = context.userId
    ? [...new Set(members.filter((member) => member.id === context.userId).map((member) => member.group))]
    : [];
  const myAssignmentGroupIds = context.userId
    ? [...new Set(event.slots
      .filter((slot) => slot.groupId && slot.assignments.some((assignment) => assignment.discordUserId === context.userId))
      .map((slot) => slot.groupId!))]
    : [];
  const participantsWithBid = new Set(members.filter((member) => member.hasBid).map((member) => member.id));
  const eligibility = lootEligibility({
    isLoggedIn: Boolean(context.userId),
    hasActiveGuildProfile: Boolean(context.hasActiveGuildProfile),
    isParticipant: Boolean(context.userId && participantIds.has(context.userId)),
    isPoolDrawn: event.raffles[0]?.status === "DRAWN",
  });
  const raffles = event.raffles.map((raffle) => ({
    ...raffle,
    items: raffle.items.map((item) => ({
      ...item,
      bidCount: item.bids.length,
      hasMyBid: context.userId
        ? item.bids.some((bid) => bid.discordUserId === context.userId)
        : false,
      canDelete: Boolean(context.userId && (isOwner || item.addedById === context.userId)),
      bids: isOwner ? item.bids : [],
    })),
  }));

  return {
    ...event,
    raffles,
    isOwner,
    members,
    myAssignmentGroups,
    myAssignmentGroupIds,
    participantCount: participantIds.size,
    participantsWithBidCount: participantsWithBid.size,
    canAddLoot: eligibility === "ALLOWED",
    lootEligibility: eligibility,
  };
};

const updateLootSortOrders = async (eventId: string, lootRaffleId: string) => {
  const remainingItems = await prisma.lootItem.findMany({
    where: { eventId, lootRaffleId },
    orderBy: { sortOrder: "asc" },
  });

  await Promise.all(
    remainingItems.map((item, index) =>
      prisma.lootItem.update({
        where: { id: item.id },
        data: { sortOrder: index },
      }),
    ),
  );
};

export const handleApiRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  user?: AuthenticatedUser,
  activeGuildId?: string,
  activeGuildProfileName?: string,
  sharedServers: Array<{ id: string; name: string; iconUrl?: string }> = [],
) => {
  try {
    const eventContext = {
      userId: user?.id,
      hasActiveGuildProfile: Boolean(activeGuildProfileName),
    };
    if (request.method === "GET" && url.pathname === "/api/guild/channels") {
      if (!activeGuildId) {
        json(response, 200, { channels: [] });
        return true;
      }

      json(response, 200, { channels: await botGuildTextChannels(activeGuildId) });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      const guildIds = sharedServers.map((server) => server.id);
      const events = guildIds.length
        ? await prisma.event.findMany({
            where: {
              guildId: { in: guildIds },
              status: "OPEN",
            },
            orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
            select: {
              id: true,
              guildId: true,
              name: true,
              startsAt: true,
              status: true,
              createdByName: true,
            },
          })
        : [];

      json(response, 200, {
        servers: sharedServers.map((server) => {
          const activeEvents = events.filter((event) => event.guildId === server.id);
          return {
            id: server.id,
            name: server.name,
            iconUrl: server.iconUrl,
            activeEventCount: activeEvents.length,
            activeEvents: activeEvents.slice(0, 5).map((event) => ({
              id: event.id,
              name: event.name,
              startsAt: event.startsAt,
              status: event.status,
              createdByName: event.createdByName,
            })),
          };
        }),
      });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/templates") {
      if (!activeGuildId) {
        json(response, 200, { templates: [] });
        return true;
      }

      await ensureDefaultTemplate(activeGuildId);
      const templates = await prisma.eventTemplate.findMany({
        where: { guildId: activeGuildId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        include: templateInclude,
      });

      json(response, 200, { templates });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/templates") {
      if (!activeGuildId || !user || !activeGuildProfileName) {
        json(response, 400, { error: "Select a server before creating templates." });
        return true;
      }

      const body: { name?: string; slots?: unknown; groups?: unknown } =
        await readJsonBody<{ name?: string; slots?: unknown; groups?: unknown }>(request).catch(() => ({}));
      const name = body.name?.trim();
      const slots = normalizeTemplateSlots(body.slots);
      let groups: ActivityGroupSeed[];
      try {
        groups = body.groups ? normalizeActivityGroups(body.groups) : activityGroupsFromSlots(slots, true);
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : "Invalid template groups." });
        return true;
      }

      if (!name) {
        json(response, 400, { error: "Template name is required." });
        return true;
      }

      if (!groups.length) {
        json(response, 400, { error: "Add at least one fleet or ground role." });
        return true;
      }

      const duplicate = await prisma.eventTemplate.findFirst({
        where: { guildId: activeGuildId, name },
      });
      if (duplicate) {
        json(response, 409, { error: "A template with that name already exists on this server." });
        return true;
      }

      const template = await prisma.$transaction(async (tx) => {
        const created = await tx.eventTemplate.create({ data: {
          guildId: activeGuildId,
          createdById: user.id,
          createdByName: activeGuildProfileName,
          name,
        } });
        await writeTemplateGroups(tx, created.id, groups);
        return tx.eventTemplate.findUniqueOrThrow({ where: { id: created.id }, include: templateInclude });
      });

      json(response, 201, { template });
      return true;
    }

    const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
    if (request.method === "PUT" && templateMatch) {
      if (!activeGuildId) {
        json(response, 400, { error: "Select a server before editing templates." });
        return true;
      }

      const existing = await prisma.eventTemplate.findFirst({
        where: { id: templateMatch[1], guildId: activeGuildId },
      });
      if (!existing) {
        json(response, 404, { error: "Template not found." });
        return true;
      }

      const body: { name?: string; slots?: unknown; groups?: unknown } =
        await readJsonBody<{ name?: string; slots?: unknown; groups?: unknown }>(request).catch(() => ({}));
      const name = body.name?.trim();
      const slots = normalizeTemplateSlots(body.slots);
      let groups: ActivityGroupSeed[];
      try {
        groups = body.groups ? normalizeActivityGroups(body.groups) : activityGroupsFromSlots(slots, true);
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : "Invalid template groups." });
        return true;
      }

      if (!name) {
        json(response, 400, { error: "Template name is required." });
        return true;
      }

      if (!groups.length) {
        json(response, 400, { error: "Add at least one fleet or ground role." });
        return true;
      }

      const duplicate = await prisma.eventTemplate.findFirst({
        where: { guildId: activeGuildId, name, id: { not: existing.id } },
      });
      if (duplicate) {
        json(response, 409, { error: "A template with that name already exists on this server." });
        return true;
      }

      const template = await prisma.$transaction(async (tx) => {
        await tx.eventTemplateSlot.deleteMany({ where: { templateId: existing.id } });
        await tx.eventTemplateGroup.deleteMany({ where: { templateId: existing.id } });
        await tx.eventTemplate.update({
          where: { id: existing.id },
          data: { name },
        });
        await writeTemplateGroups(tx, existing.id, groups);
        return tx.eventTemplate.findUniqueOrThrow({ where: { id: existing.id }, include: templateInclude });
      });

      json(response, 200, { template });
      return true;
    }

    if (request.method === "DELETE" && templateMatch) {
      if (!activeGuildId) {
        json(response, 400, { error: "Select a server before deleting templates." });
        return true;
      }

      const existing = await prisma.eventTemplate.findFirst({
        where: { id: templateMatch[1], guildId: activeGuildId },
      });
      if (!existing) {
        json(response, 404, { error: "Template not found." });
        return true;
      }

      await prisma.eventTemplate.delete({ where: { id: existing.id } });
      json(response, 200, { ok: true });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      if (!activeGuildId) {
        json(response, 200, []);
        return true;
      }

      const status = url.searchParams.get("status");
      const mine = url.searchParams.get("mine") === "yes";
      const events = await prisma.event.findMany({
        where: {
          guildId: activeGuildId,
          status: status === "OPEN" || status === "CLOSED" ? status : undefined,
          assignments: mine && user ? { some: { discordUserId: user.id } } : undefined,
        },
        orderBy: { createdAt: "desc" },
        include: {
          groups: { orderBy: { sortOrder: "asc" } },
          slots: { include: { assignments: true } },
          raffles: { include: { items: true } },
        },
        take: 50,
      });

      json(response, 200, events);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/slot-presets") {
      json(response, 200, slotPresets);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      const startedAt = Date.now();
      const body: {
        name?: string;
        description?: string;
        logoUrl?: string;
        startsAt?: string;
        lootDurationHours?: number;
        preset?: SlotPresetName | "custom";
        customSlots?: string;
        groups?: unknown;
        extraCrewCapacity?: number;
        guildId?: string;
      } = await readJsonBody<{
        name?: string;
        description?: string;
        logoUrl?: string;
        startsAt?: string;
        lootDurationHours?: number;
        preset?: SlotPresetName | "custom";
        customSlots?: string;
        groups?: unknown;
        extraCrewCapacity?: number;
        guildId?: string;
      }>(request).catch(() => ({}));

      if (!body || !body.name || !body.name.trim()) {
        json(response, 400, { error: "Event name is required." });
        return true;
      }

      const preset = body.preset ?? "combat-op";
      if (preset !== "custom" && !(preset in slotPresets)) {
        json(response, 400, { error: "Invalid event preset." });
        return true;
      }

      if (!activeGuildId && !body.guildId) {
        json(response, 400, {
          error: "No active server selected. Please select a server in the top menu first.",
        });
        return true;
      }

      const guildId = activeGuildId ?? body.guildId ?? "";

      if (!user || !activeGuildProfileName) {
        json(response, 400, {
          error: "Select a server where the bot can read your Discord server profile before creating events.",
        });
        return true;
      }

      let startsAt: Date | undefined;
      try {
        startsAt = parseEventStart(body.startsAt);
      } catch (error) {
        json(response, 400, {
          error: error instanceof Error ? error.message : "Invalid event start time.",
        });
        return true;
      }

      let groups: ActivityGroupSeed[] | undefined;
      if (body.groups) {
        try {
          groups = normalizeActivityGroups(body.groups);
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : "Invalid event groups." });
          return true;
        }
      }

      const event = await createEvent({
        guildId,
        createdById: user.id,
        createdByName: activeGuildProfileName,
        name: body.name.trim(),
        description: body.description?.trim() || undefined,
        logoUrl: body.logoUrl?.trim() || undefined,
        startsAt,
        lootDurationHours: body.lootDurationHours === 48 ? 48 : 24,
        preset,
        customSlots: body.customSlots,
        groups,
        extraCrewCapacity: body.extraCrewCapacity,
      }).catch((error) => {
        throw new Error(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
      });

      await publishEventPanel(event.id);

      console.log(`Created web event ${event.id} in ${Date.now() - startedAt}ms.`);
      jsonAndNotifyEventsChanged(
        response,
        201,
        {
          id: event.id,
          createdById: event.createdById,
          createdByName: event.createdByName,
          name: event.name,
          description: event.description,
          logoUrl: event.logoUrl,
          startsAt: event.startsAt,
          status: event.status,
          lootDurationHours: event.lootDurationHours,
          groups: event.groups,
          slots: event.slots,
          raffles: [],
          members: [],
          isOwner: true,
          myAssignmentGroups: [],
          myAssignmentGroupIds: [],
        },
      );
      return true;
    }

    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (request.method === "GET" && eventMatch) {
      const event = await eventDetails(eventMatch[1], eventContext);
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      json(response, 200, event);
      return true;
    }

    const endEventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/end$/);
    if (request.method === "POST" && endEventMatch) {
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      const event = await prisma.event.findUnique({ where: { id: endEventMatch[1] } });
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      if (event.createdById !== user.id) {
        json(response, 403, { error: "Only the event owner can end this event." });
        return true;
      }

      await endEvent(event.id);
      await publishEventPanel(event.id);
      await publishLootPanel(event.id);
      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(event.id, eventContext),
      );
      return true;
    }

    const joinSlotMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/slots\/([^/]+)\/join$/);
    if (request.method === "POST" && joinSlotMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      if (!activeGuildProfileName) {
        json(response, 400, {
          error: "Select a server where the bot can read your Discord server profile before joining events.",
        });
        return true;
      }

      const slot = await prisma.crewSlot.findUnique({
        where: { id: joinSlotMatch[2] },
        include: { event: true },
      });

      if (!slot || slot.eventId !== joinSlotMatch[1] || slot.event.status !== "OPEN") {
        json(response, 400, { error: "That signup slot is no longer open." });
        return true;
      }

      if (activeGuildId && slot.event.guildId !== activeGuildId) {
        json(response, 403, { error: "That event is not in your active server." });
        return true;
      }

      if (slot.assignmentGroup === "extra") {
        const regularSlots = await prisma.crewSlot.findMany({
          where: {
            eventId: slot.eventId,
            assignmentGroup: { not: "extra" },
          },
          include: { assignments: true },
        });
        const regularSlotsFull =
          regularSlots.length > 0 &&
          regularSlots.every((regularSlot) => regularSlot.assignments.length >= regularSlot.capacity);

        if (!regularSlotsFull) {
          json(response, 400, { error: "Extra crew opens after the listed roles are full." });
          return true;
        }
      }

      await prisma.$transaction(async (tx) => {
        if (slot.assignmentGroup !== "extra") {
          const extraAssignment = await tx.crewAssignment.findFirst({
            where: {
              eventId: slot.eventId,
              discordUserId: user.id,
              assignmentGroup: "extra",
            },
          });

          if (extraAssignment) {
            throw new Error("Extra crew members can only stay in the extra crew area.");
          }
        }

        await tx.crewAssignment.deleteMany({
          where: {
            eventId: slot.eventId,
            discordUserId: user.id,
            assignmentGroup: slot.assignmentGroup === "extra" ? undefined : slot.assignmentGroup,
          },
        });

        const taken = await tx.crewAssignment.count({ where: { crewSlotId: slot.id } });
        if (taken >= slot.capacity) {
          throw new Error("That slot filled up just before you clicked it.");
        }

        await tx.crewAssignment.create({
          data: {
            eventId: slot.eventId,
            crewSlotId: slot.id,
            assignmentGroup: slot.assignmentGroup,
            discordUserId: user.id,
            discordTag: activeGuildProfileName,
          },
        });
      });

      await publishEventPanel(slot.eventId);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(slot.eventId, eventContext),
      );
      return true;
    }

    const leaveGroupMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/leave\/(ship|ground)$/);
    if (request.method === "POST" && leaveGroupMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      await prisma.crewAssignment.deleteMany({
        where: {
          eventId: leaveGroupMatch[1],
          discordUserId: user.id,
          assignmentGroup: leaveGroupMatch[2],
        },
      });

      await publishEventPanel(leaveGroupMatch[1]);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(leaveGroupMatch[1], eventContext),
      );
      return true;
    }

    const leaveActivityGroupMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/groups\/([^/]+)\/leave$/);
    if (request.method === "POST" && leaveActivityGroupMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      const group = await prisma.eventGroup.findUnique({
        where: { id: leaveActivityGroupMatch[2] },
        include: { event: true },
      });
      if (!group || group.eventId !== leaveActivityGroupMatch[1]) {
        json(response, 404, { error: "Activity group not found." });
        return true;
      }
      if (activeGuildId && group.event.guildId !== activeGuildId) {
        json(response, 403, { error: "That event is not in your active server." });
        return true;
      }

      await prisma.crewAssignment.deleteMany({
        where: {
          eventId: group.eventId,
          discordUserId: user.id,
          crewSlot: { groupId: group.id },
        },
      });

      await publishEventPanel(group.eventId);
      jsonAndNotifyEventsChanged(response, 200, await eventDetails(group.eventId, eventContext));
      return true;
    }

    const leaveEventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/leave$/);
    if (request.method === "POST" && leaveEventMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      await prisma.crewAssignment.deleteMany({
        where: {
          eventId: leaveEventMatch[1],
          discordUserId: user.id,
        },
      });

      await publishEventPanel(leaveEventMatch[1]);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(leaveEventMatch[1], eventContext),
      );
      return true;
    }

    const drawLootMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/loot\/draw$/);
    if (request.method === "POST" && drawLootMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      const event = await prisma.event.findUnique({ where: { id: drawLootMatch[1] } });
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      if (event.createdById !== user.id) {
        json(response, 403, { error: "Only the event owner can roll this loot pool." });
        return true;
      }

      const raffle = await drawRaffleByEventId(event.id);
      if (!raffle) {
        json(response, 404, { error: "Loot pool not found." });
        return true;
      }

      await publishLootPanel(event.id);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(event.id, eventContext),
      );
      return true;
    }

    const addLootMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/loot\/items$/);
    if (request.method === "POST" && addLootMatch) {
      const body = await readJsonBody<{ items?: string[] | string }>(request);
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      if (!activeGuildProfileName) {
        json(response, 400, {
          error: "Select a server where the bot can read your Discord server profile before adding loot.",
        });
        return true;
      }

      const items = parseItems(body.items);
      if (!items.length) {
        json(response, 400, { error: "At least one loot item is required." });
        return true;
      }

      const lootEvent = await prisma.event.findUnique({
        where: { id: addLootMatch[1] },
        include: { raffles: { orderBy: { createdAt: "asc" }, take: 1 } },
      });
      const activeRaffle = lootEvent?.raffles[0];
      if (!lootEvent || !activeRaffle) {
        json(response, 404, { error: "Loot pool not found." });
        return true;
      }

      if (activeRaffle.status === "DRAWN") {
        json(response, 409, { error: "This loot pool has already been drawn. No more items can be added." });
        return true;
      }

      const participant = await prisma.crewAssignment.findFirst({
        where: {
          eventId: addLootMatch[1],
          discordUserId: user.id,
        },
      });

      if (!participant) {
        json(response, 403, { error: "Only event participants can add loot." });
        return true;
      }

      const raffle = await addLootItems(addLootMatch[1], items, {
        id: user.id,
        name: activeGuildProfileName,
      });
      if (!raffle) {
        json(response, 404, { error: "Loot pool not found." });
        return true;
      }

      await publishLootPanel(addLootMatch[1]);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(addLootMatch[1], eventContext),
      );
      return true;
    }

    const bidLootMatch = url.pathname.match(/^\/api\/loot\/items\/([^/]+)\/bid$/);
    if (request.method === "POST" && bidLootMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      if (!activeGuildProfileName) {
        json(response, 400, {
          error: "Select a server where the bot can read your Discord server profile before bidding.",
        });
        return true;
      }

      const item = await prisma.lootItem.findUnique({
        where: { id: bidLootMatch[1] },
        include: { raffle: true },
      });

      if (!item || item.raffle.status !== "OPEN") {
        json(response, 400, { error: "That loot roll is no longer open." });
        return true;
      }

      const participant = await prisma.crewAssignment.findFirst({
        where: {
          eventId: item.eventId,
          discordUserId: user.id,
        },
      });

      if (!participant) {
        json(response, 403, { error: "Only event participants can bid on loot." });
        return true;
      }

      const existing = await prisma.lootBid.findUnique({
        where: {
          lootItemId_discordUserId: {
            lootItemId: item.id,
            discordUserId: user.id,
          },
        },
      });

      if (existing) {
        await prisma.lootBid.delete({ where: { id: existing.id } });
      } else {
        await prisma.lootBid.create({
          data: {
            lootItemId: item.id,
            discordUserId: user.id,
            discordTag: activeGuildProfileName,
          },
        });
      }

      await publishLootPanel(item.eventId);

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(item.eventId, eventContext),
      );
      return true;
    }

    const deleteLootMatch = url.pathname.match(/^\/api\/loot\/items\/([^/]+)$/);
    if (request.method === "DELETE" && deleteLootMatch) {
      await readJsonBody<Record<string, never>>(request).catch(() => ({}));
      if (!user) {
        json(response, 401, { error: "Discord login is required." });
        return true;
      }

      const item = await prisma.lootItem.findUnique({
        where: { id: deleteLootMatch[1] },
        include: { raffle: { include: { event: true } } },
      });
      if (!item) {
        json(response, 404, { error: "Loot item not found." });
        return true;
      }

      const isOwner = item.raffle.event.createdById === user.id;
      if (!isOwner && item.addedById !== user.id) {
        json(response, 403, { error: "Only the item creator or event owner can delete this loot item." });
        return true;
      }

      await prisma.lootItem.delete({ where: { id: item.id } });
      await updateLootSortOrders(item.eventId, item.lootRaffleId);
      await publishLootPanel(item.eventId);
      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(item.eventId, eventContext),
      );
      return true;
    }

    if (url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "API route not found." });
      return true;
    }

    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected API error.";
    json(response, 500, { error: message });
    return true;
  }
};
