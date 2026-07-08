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
  addedById: string;
  addedByName: string;
  winnerUserId: string | null;
  winnerTag: string | null;
  bidCount: number;
  hasMyBid: boolean;
  canDelete: boolean;
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
  createdByName: string;
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
  participantCount: number;
  participantsWithBidCount: number;
  canAddLoot: boolean;
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
  activeServer?: {
    id: string;
    name: string;
    userProfile?: ServerProfile;
  };
  servers: Array<{
    id: string;
    name: string;
    userProfile?: ServerProfile;
  }>;
  requiresServerSetup: boolean;
  requiresGuildReconnect: boolean;
};

export type ServerProfile = {
  guildId: string;
  userId: string;
  displayName: string;
  nickname?: string;
  username: string;
  avatar?: string;
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
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/items`, {
      items,
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  removeLootItem(eventId: string, itemId: string) {
    return this.http.request<EventDetails>("DELETE", `/api/loot/items/${itemId}`, {
      body: { ownerKey: this.ownerKeyForEvent(eventId) },
    });
  }

  drawLoot(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/draw`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  endEvent(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/end`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  joinSlot(eventId: string, slotId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/slots/${slotId}/join`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  leaveEvent(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/leave`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
  }

  toggleLootBid(eventId: string, itemId: string) {
    return this.http.post<EventDetails>(`/api/loot/items/${itemId}/bid`, {
      ownerKey: this.ownerKeyForEvent(eventId),
    });
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
