import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { createEvent, eventInclude } from "./events/event-service.js";
import { addLootItems, drawRaffleByEventId, lootInclude } from "./loot/loot-service.js";
import { type SlotPresetName, slotPresets } from "./slot-presets.js";

const json = (response: ServerResponse, statusCode: number, data: unknown) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
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

const eventDetails = async (eventId: string, ownerKey?: string) => {
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

  const members = event.slots.flatMap((slot) =>
    slot.assignments.map((assignment) => ({
      id: assignment.discordUserId,
      name: assignment.discordTag,
      slot: slot.label,
      group: slot.assignmentGroup,
      hasBid: event.raffles.some((raffle) =>
        raffle.items.some((item) =>
          item.bids.some((bid) => bid.discordUserId === assignment.discordUserId),
        ),
      ),
    })),
  );

  const safeEvent = removeOwnerWebKey(event);

  return { ...safeEvent, isOwner: event.ownerWebKey ? ownerKey === event.ownerWebKey : false, members };
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
) => {
  try {
    if (request.method === "GET" && url.pathname === "/api/events") {
      const events = await prisma.event.findMany({
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
      }>(request);

      if (!body.name?.trim()) {
        json(response, 400, { error: "Event name is required." });
        return true;
      }

      const preset = body.preset ?? "combat-op";
      if (preset !== "custom" && !(preset in slotPresets)) {
        json(response, 400, { error: "Invalid event preset." });
        return true;
      }

      const ownerKey = createOwnerWebKey();
      const event = await createEvent({
        guildId: body.guildId ?? "web",
        channelId: body.channelId ?? "web",
        createdById: "web",
        ownerWebKey: ownerKey,
        name: body.name.trim(),
        description: body.description?.trim() || undefined,
        logoUrl: body.logoUrl?.trim() || undefined,
        startsAt: parseDate(body.startsAt),
        lootDurationHours: body.lootDurationHours === 48 ? 48 : 24,
        preset,
        customSlots: body.customSlots,
      });

      const details = await eventDetails(event.id, ownerKey);
      json(response, 201, details ? { ...details, ownerKey } : { ownerKey });
      return true;
    }

    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (request.method === "GET" && eventMatch) {
      const ownerKey = url.searchParams.get("ownerKey") ?? undefined;
      const event = await eventDetails(eventMatch[1], ownerKey);
      if (!event) {
        json(response, 404, { error: "Event not found." });
        return true;
      }

      json(response, 200, event);
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

      json(response, 200, await eventDetails(event.id, body.ownerKey));
      return true;
    }

    const addLootMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/loot\/items$/);
    if (request.method === "POST" && addLootMatch) {
      const body = await readJsonBody<{ items?: string[] | string }>(request);
      const items = parseItems(body.items);
      if (!items.length) {
        json(response, 400, { error: "At least one loot item is required." });
        return true;
      }

      const raffle = await addLootItems(addLootMatch[1], items);
      if (!raffle) {
        json(response, 404, { error: "Loot pool not found." });
        return true;
      }

      json(response, 200, await eventDetails(addLootMatch[1]));
      return true;
    }

    const deleteLootMatch = url.pathname.match(/^\/api\/loot\/items\/([^/]+)$/);
    if (request.method === "DELETE" && deleteLootMatch) {
      const item = await prisma.lootItem.findUnique({ where: { id: deleteLootMatch[1] } });
      if (!item) {
        json(response, 404, { error: "Loot item not found." });
        return true;
      }

      await prisma.lootItem.delete({ where: { id: item.id } });
      await updateLootSortOrders(item.eventId, item.lootRaffleId);
      json(response, 200, await eventDetails(item.eventId));
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
