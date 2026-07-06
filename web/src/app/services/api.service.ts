import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";

export type EventMember = {
  id: string;
  name: string;
  slot: string;
  group: "ship" | "ground";
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
  slots: Array<{ assignments: unknown[] }>;
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

@Injectable({ providedIn: "root" })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  listEvents() {
    return this.http.get<EventSummary[]>("/api/events");
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

  rememberOwnerKey(eventId: string, ownerKey: string) {
    localStorage.setItem(this.ownerStorageKey(eventId), ownerKey);
  }

  ownerKeyForEvent(eventId: string) {
    return localStorage.getItem(this.ownerStorageKey(eventId)) ?? "";
  }

  private ownerStorageKey(eventId: string) {
    return `star-citizen-event-owner:${eventId}`;
  }
}
