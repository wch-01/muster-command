import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { createEvent, endEvent, eventInclude } from "./events/event-service.js";
import { addLootItems, drawRaffleByEventId, lootInclude } from "./loot/loot-service.js";
import { type SlotPresetName, slotPresets } from "./slot-presets.js";
import type { AuthenticatedUser } from "./auth.js";
import { notifyEventsChanged } from "./event-stream.js";
import { botGuildTextChannels } from "./bot-runtime.js";

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

const parseDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date.");
  }

  return date;
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

const createOwnerWebKey = () => randomBytes(32).toString("hex");

const removeOwnerWebKey = <T extends { ownerWebKey?: string | null }>(event: T) => {
  const { ownerWebKey, ...safeEvent } = event;
  return safeEvent;
};

const eventDetails = async (
  eventId: string,
  context: { ownerKey?: string; userId?: string } = {},
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

  const isOwner = event.ownerWebKey ? context.ownerKey === event.ownerWebKey : false;
  const participantIds = new Set(members.map((member) => member.id));
  const participantsWithBid = new Set(members.filter((member) => member.hasBid).map((member) => member.id));
  const safeEvent = removeOwnerWebKey(event);
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
    ...safeEvent,
    raffles,
    isOwner,
    members,
    participantCount: participantIds.size,
    participantsWithBidCount: participantsWithBid.size,
    canAddLoot: Boolean(context.userId && participantIds.has(context.userId)),
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
          slots: { include: { assignments: true } },
          raffles: { include: { items: true } },
        },
        take: 50,
      });

      json(response, 200, events.map(removeOwnerWebKey));
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/slot-presets") {
      json(response, 200, slotPresets);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      const startedAt = Date.now();
      const body = await readJsonBody<{
        name?: string;
        description?: string;
        logoUrl?: string;
        startsAt?: string;
        lootDurationHours?: number;
        preset?: SlotPresetName | "custom";
        customSlots?: string;
        guildId?: string;
        channelId?: string;
      }>(request).catch(() => ({}) as any);

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

      const ownerKey = createOwnerWebKey();
      if (!user || !activeGuildProfileName) {
        json(response, 400, {
          error: "Select a server where the bot can read your Discord server profile before creating events.",
        });
        return true;
      }

      const event = await createEvent({
        guildId: activeGuildId ?? body.guildId ?? "web",
        channelId: body.channelId ?? "web",
        createdById: user.id,
        createdByName: activeGuildProfileName,
        ownerWebKey: ownerKey,
        name: body.name.trim(),
        description: body.description?.trim() || undefined,
        logoUrl: body.logoUrl?.trim() || undefined,
        startsAt: parseDate(body.startsAt),
        lootDurationHours: body.lootDurationHours === 48 ? 48 : 24,
        preset,
        customSlots: body.customSlots,
      }).catch((error) => {
        throw new Error(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
      });

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
          slots: event.slots,
          raffles: [],
          members: [],
          isOwner: true,
          ownerKey,
        },
      );
      return true;
    }

    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (request.method === "GET" && eventMatch) {
      const ownerKey = url.searchParams.get("ownerKey") ?? undefined;
      const event = await eventDetails(eventMatch[1], { ownerKey, userId: user?.id });
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      json(response, 200, event);
      return true;
    }

    const endEventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/end$/);
    if (request.method === "POST" && endEventMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request);
      const event = await prisma.event.findUnique({ where: { id: endEventMatch[1] } });
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      if (!event.ownerWebKey || event.ownerWebKey !== body.ownerKey) {
        json(response, 403, { error: "Only the event owner can end this event." });
        return true;
      }

      await endEvent(event.id);
      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(event.id, { ownerKey: body.ownerKey, userId: user?.id }),
      );
      return true;
    }

    const joinSlotMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/slots\/([^/]+)\/join$/);
    if (request.method === "POST" && joinSlotMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request).catch(
        () => ({}) as { ownerKey?: string },
      );
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

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(slot.eventId, { ownerKey: body.ownerKey, userId: user.id }),
      );
      return true;
    }

    const leaveEventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/leave$/);
    if (request.method === "POST" && leaveEventMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request).catch(
        () => ({}) as { ownerKey?: string },
      );
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

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(leaveEventMatch[1], { ownerKey: body.ownerKey, userId: user.id }),
      );
      return true;
    }

    const drawLootMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/loot\/draw$/);
    if (request.method === "POST" && drawLootMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request);
      const event = await prisma.event.findUnique({ where: { id: drawLootMatch[1] } });
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      if (!event.ownerWebKey || event.ownerWebKey !== body.ownerKey) {
        json(response, 403, { error: "Only the event owner can roll this loot pool." });
        return true;
      }

      const raffle = await drawRaffleByEventId(event.id);
      if (!raffle) {
        json(response, 404, { error: "Loot pool not found." });
        return true;
      }

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(event.id, { ownerKey: body.ownerKey, userId: user?.id }),
      );
      return true;
    }

    const addLootMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/loot\/items$/);
    if (request.method === "POST" && addLootMatch) {
      const body = await readJsonBody<{ items?: string[] | string; ownerKey?: string }>(request);
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

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(addLootMatch[1], { ownerKey: body.ownerKey, userId: user.id }),
      );
      return true;
    }

    const bidLootMatch = url.pathname.match(/^\/api\/loot\/items\/([^/]+)\/bid$/);
    if (request.method === "POST" && bidLootMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request).catch(
        () => ({}) as { ownerKey?: string },
      );
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

      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(item.eventId, { ownerKey: body.ownerKey, userId: user.id }),
      );
      return true;
    }

    const deleteLootMatch = url.pathname.match(/^\/api\/loot\/items\/([^/]+)$/);
    if (request.method === "DELETE" && deleteLootMatch) {
      const body = await readJsonBody<{ ownerKey?: string }>(request).catch(
        () => ({}) as { ownerKey?: string },
      );
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

      const isOwner = Boolean(item.raffle.event.ownerWebKey && item.raffle.event.ownerWebKey === body.ownerKey);
      if (!isOwner && item.addedById !== user.id) {
        json(response, 403, { error: "Only the item creator or event owner can delete this loot item." });
        return true;
      }

      await prisma.lootItem.delete({ where: { id: item.id } });
      await updateLootSortOrders(item.eventId, item.lootRaffleId);
      jsonAndNotifyEventsChanged(
        response,
        200,
        await eventDetails(item.eventId, { ownerKey: body.ownerKey, userId: user.id }),
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
