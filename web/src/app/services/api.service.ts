import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";

export type EventMember = {
  id: string;
  name: string;
  slot: string;
  group: "ship" | "ground" | "extra";
  hasBid: boolean;
};

export type LootBid = {
  id: string;
  discordUserId: string;
  discordTag: string;
};

export type LootItem = {
  id: string;
  name: string;
  winnerUserId: string | null;
  winnerTag: string | null;
  bids: LootBid[];
};

export type LootRaffle = {
  id: string;
  eventId: string;
  status: "OPEN" | "DRAWN";
  endsAt: string | null;
  items: LootItem[];
};

export type EventSummary = {
  id: string;
  createdById: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  startsAt: string | null;
  status: "OPEN" | "CLOSED";
  lootDurationHours: number;
  slots: Array<{
    id: string;
    category: string;
    assignmentGroup: "ship" | "ground" | "extra";
    label: string;
    capacity: number;
    assignments: Array<{ discordUserId: string; discordTag: string }>;
  }>;
  raffles: Array<{ items: unknown[] }>;
};

export type EventDetails = EventSummary & {
  isOwner: boolean;
  members: EventMember[];
  raffles: LootRaffle[];
};

export type CreatedEventDetails = EventDetails & {
  ownerKey: string;
};

export type CreateEventInput = {
  name: string;
  description?: string;
  logoUrl?: string;
  startsAt?: string;
  lootDurationHours: number;
  preset: string;
  customSlots?: string;
};

export type WebSession = {
  user: {
    id: string;
    username: string;
    globalName?: string;
  };
  isSuperAdmin: boolean;
  activeServer?: { id: string; name: string };
  servers: Array<{ id: string; name: string }>;
  requiresServerSetup: boolean;
  requiresGuildReconnect: boolean;
};

@Injectable({ providedIn: "root" })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getSession() {
    return this.http.get<WebSession>("/api/session");
  }

  listEvents() {
    return this.http.get<EventSummary[]>("/api/events");
  }

  listActiveEvents() {
    return this.http.get<EventSummary[]>("/api/events?status=OPEN");
  }

  listPastEvents() {
    return this.http.get<EventSummary[]>("/api/events?status=CLOSED&mine=yes");
  }

  getEvent(id: string) {
    const ownerKey = this.ownerKeyForEvent(id);
    const suffix = ownerKey ? `?ownerKey=${encodeURIComponent(ownerKey)}` : "";
    return this.http.get<EventDetails>(`/api/events/${id}${suffix}`);
  }

  createEvent(input: CreateEventInput) {
    return this.http.post<CreatedEventDetails>("/api/events", input);
  }

  addLootItems(eventId: string, items: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/items`, { items });
  }

  removeLootItem(itemId: string) {
    return this.http.delete<EventDetails>(`/api/loot/items/${itemId}`);
  }

  drawLoot(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/draw`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  joinSlot(eventId: string, slotId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/slots/${slotId}/join`, {});
  }

  leaveEvent(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/leave`, {});
  }

  rememberOwnerKey(eventId: string, ownerKey: string) {
    try {
      localStorage.setItem(this.ownerStorageKey(eventId), ownerKey);
    } catch (error) {
      console.warn("Could not save event owner key to local storage:", error);
    }
  }

  ownerKeyForEvent(eventId: string) {
    try {
      return localStorage.getItem(this.ownerStorageKey(eventId)) ?? "";
    } catch (error) {
      return "";
    }
  }

  private ownerStorageKey(eventId: string) {
    return `star-citizen-event-owner:${eventId}`;
  }
}
