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
  myAssignmentGroups: Array<"ship" | "ground" | "extra">;
  raffles: LootRaffle[];
  participantCount: number;
  participantsWithBidCount: number;
  canAddLoot: boolean;
};

export type CreatedEventDetails = EventDetails;

export type CreateEventInput = {
  name: string;
  description?: string;
  logoUrl?: string;
  startsAt?: string;
  lootDurationHours: number;
  preset: string;
  customSlots?: string;
};

export type TemplateSlot = {
  id: string;
  category: string;
  assignmentGroup: "ship" | "ground";
  label: string;
  capacity: number;
  sortOrder: number;
};

export type EventTemplateSummary = {
  id: string;
  guildId: string;
  createdById: string;
  createdByName: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  slots: TemplateSlot[];
};

export type SaveTemplateInput = {
  name: string;
  slots: Array<{
    category: string;
    assignmentGroup: "ship" | "ground";
    label: string;
    capacity: number;
  }>;
};

export type WebSession = {
  user: {
    id: string;
    username: string;
    globalName?: string;
  };
  isSuperAdmin: boolean;
  state: "development" | "production";
  botInviteUrl?: string;
  activeServer?: {
    id: string;
    name: string;
    iconUrl?: string;
    userProfile?: ServerProfile;
  };
  servers: Array<{
    id: string;
    name: string;
    iconUrl?: string;
    userProfile?: ServerProfile;
  }>;
  requiresServerSetup: boolean;
  requiresGuildReconnect: boolean;
};

export type DashboardEvent = {
  id: string;
  name: string;
  startsAt: string | null;
  status: "OPEN" | "CLOSED";
  createdByName: string;
};

export type DashboardServer = {
  id: string;
  name: string;
  iconUrl?: string;
  activeEventCount: number;
  activeEvents: DashboardEvent[];
};

export type DashboardSummary = {
  servers: DashboardServer[];
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

  getDashboard() {
    return this.http.get<DashboardSummary>("/api/dashboard");
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
    return this.http.get<EventDetails>(`/api/events/${id}`);
  }

  createEvent(input: CreateEventInput) {
    return this.http.post<CreatedEventDetails>("/api/events", input);
  }

  listTemplates() {
    return this.http.get<{ templates: EventTemplateSummary[] }>("/api/templates");
  }

  createTemplate(input: SaveTemplateInput) {
    return this.http.post<{ template: EventTemplateSummary }>("/api/templates", input);
  }

  updateTemplate(id: string, input: SaveTemplateInput) {
    return this.http.put<{ template: EventTemplateSummary }>(`/api/templates/${id}`, input);
  }

  deleteTemplate(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/templates/${id}`);
  }

  addLootItems(eventId: string, items: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/items`, {
      items,
    });
  }

  removeLootItem(eventId: string, itemId: string) {
    return this.http.request<EventDetails>("DELETE", `/api/loot/items/${itemId}`, {
      body: {},
    });
  }

  drawLoot(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/loot/draw`, {});
  }

  endEvent(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/end`, {});
  }

  joinSlot(eventId: string, slotId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/slots/${slotId}/join`, {});
  }

  leaveEvent(eventId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/leave`, {});
  }

  getGuildChannels() {
    return this.http.get<{ channels: Array<{ id: string; name: string; type: string }> }>("/api/guild/channels");
  }

  leaveGroup(eventId: string, group: "ship" | "ground") {
    return this.http.post<EventDetails>(`/api/events/${eventId}/leave/${group}`, {});
  }

  toggleLootBid(eventId: string, itemId: string) {
    return this.http.post<EventDetails>(`/api/loot/items/${itemId}/bid`, {});
  }
}
