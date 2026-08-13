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
  category: LootCategory;
  quantity: number;
  quality: number | null;
  unit: string | null;
  awards: Array<{ id: string; discordUserId: string; discordTag: string; quantity: number }>;
  bidCount: number;
  hasMyBid: boolean;
  canDelete: boolean;
  canEdit: boolean;
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
  resourceLootPolicy: ResourceLootPolicy;
  resourceInstructions: string | null;
  lootInstructions: string | null;
  lootAwardMethod: AwardMethod;
  lootRepeatWinnerMode: RepeatWinnerMode;
  groups: EventGroupSummary[];
  slots: Array<{
    id: string;
    groupId: string | null;
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
  myAssignmentGroupIds: string[];
  signupConflicts: Record<string, string>;
  raffles: LootRaffle[];
  participantCount: number;
  participantsWithBidCount: number;
  canAddLoot: boolean;
  lootEligibility: "ALLOWED" | "LOGIN_REQUIRED" | "PROFILE_UNAVAILABLE" | "NOT_PARTICIPANT" | "POOL_DRAWN";
};

export type LootCategory = "RESOURCE" | "WEAPON" | "ARMOR" | "COMPONENT" | "CONSUMABLE" | "OTHER";
export type AwardMethod = "FULL_QUANTITY" | "INDIVIDUAL_UNITS";
export type RepeatWinnerMode = "ALLOW_REPEATS" | "DIFFERENT_WINNERS";
export type ResourceLootPolicy = "ANY" | "REFINED_ONLY" | "RAW_ONLY" | "NONE" | "CUSTOM";
export type LootItemInput = {
  name: string;
  category: LootCategory;
  quantity: number;
  quality: number | null;
  unit: string | null;
};

export type ScheduleMode = "EVENT_START" | "SPECIFIC_TIME" | "AFTER_GROUP" | "AS_DIRECTED";

export type EventGroupSummary = {
  id: string;
  kind: "FLEET" | "GROUND";
  name: string;
  scheduleMode: ScheduleMode;
  startsAt: string | null;
  timingNote: string | null;
  predecessorGroupId: string | null;
  sortOrder: number;
};

export type ActivityGroupInput = {
  clientId: string;
  kind: "FLEET" | "GROUND";
  name: string;
  scheduleMode: ScheduleMode;
  startsAt?: string;
  timingNote?: string;
  predecessorClientId?: string;
  ships?: Array<{
    name: string;
    roles: Array<{ label: string; capacity: number }>;
  }>;
  roles?: Array<{ label: string; capacity: number }>;
};

export type CreatedEventDetails = EventDetails;

export type CreateEventInput = {
  name: string;
  description?: string;
  logoUrl?: string;
  startsAt?: string;
  lootDurationHours: number;
  resourceLootPolicy: ResourceLootPolicy;
  resourceInstructions?: string;
  lootInstructions?: string;
  lootAwardMethod: AwardMethod;
  lootRepeatWinnerMode: RepeatWinnerMode;
  preset: string;
  customSlots?: string;
  groups?: ActivityGroupInput[];
  extraCrewCapacity?: number;
};

export type TemplateSlot = {
  id: string;
  groupId: string | null;
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
  lootDurationHours: number;
  resourceLootPolicy: ResourceLootPolicy;
  resourceInstructions: string | null;
  lootInstructions: string | null;
  lootAwardMethod: AwardMethod;
  lootRepeatWinnerMode: RepeatWinnerMode;
  slots: TemplateSlot[];
  groups: Array<{
    id: string;
    kind: "FLEET" | "GROUND";
    name: string;
    scheduleMode: ScheduleMode;
    startsAt: string | null;
    timingNote: string | null;
    predecessorGroupId: string | null;
    sortOrder: number;
  }>;
};

export type SaveTemplateInput = {
  name: string;
  lootDurationHours: number;
  resourceLootPolicy: ResourceLootPolicy;
  resourceInstructions?: string;
  lootInstructions?: string;
  lootAwardMethod: AwardMethod;
  lootRepeatWinnerMode: RepeatWinnerMode;
  groups?: ActivityGroupInput[];
  slots?: Array<{
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

export type AdminSettings = {
  discordEventPublishingEnabled: boolean;
  eventOutputMode: "channel" | "thread";
  eventOutputChannelId: string;
  lootOutputChannelId: string;
  threadAutoDeleteDays: number;
  templateControlUserIds: string[];
  templateControlRoleIds: string[];
  tier1RoleIds: string[];
  tier2RoleIds: string[];
  tier3RoleIds: string[];
  tier2Capabilities: string[];
  tier3Capabilities: string[];
};

export type AdminData = {
  settings: AdminSettings;
  permissions: {
    roles: Array<{ id: string; name: string }>;
    users: Array<{ id: string; name: string; username: string }>;
    userListAvailable: boolean;
  };
  inviteUrl?: string;
};

export type SystemAdminData = {
  configured: boolean;
  loginConfigured: boolean;
  status: { configured: boolean; connected: boolean; userTag?: string; userId?: string; guildCount: number; uptimeSeconds?: number };
  installedServers: Array<{ id: string; name: string; iconUrl?: string }>;
  publicAppUrl: string;
  publicAppUrlDetected: boolean;
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

  addLootItems(eventId: string, items: LootItemInput[]) {
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

  getAdmin() { return this.http.get<AdminData>("/api/admin"); }
  saveAdmin(settings: AdminSettings) { return this.http.put<{ ok: boolean }>("/api/admin", settings); }
  getSystemAdmin() { return this.http.get<SystemAdminData>("/api/system-admin"); }
  saveSystemAdmin(settings: { publicAppUrl: string }) { return this.http.put<{ ok: boolean }>("/api/system-admin", settings); }
  registerGuildCommands() { return this.http.post<{ message: string }>("/api/system-admin/register-guild", {}); }
  registerGlobalCommands() { return this.http.post<{ message: string }>("/api/system-admin/register-global", {}); }
  getBotCommands() { return this.http.get<{ html: string }>("/api/bot-commands"); }

  updateLootItem(eventId: string, itemId: string, item: LootItemInput) {
    return this.http.put<EventDetails>(`/api/loot/items/${itemId}`, item);
  }

  leaveActivityGroup(eventId: string, groupId: string) {
    return this.http.post<EventDetails>(`/api/events/${eventId}/groups/${groupId}/leave`, {});
  }

  toggleLootBid(eventId: string, itemId: string) {
    return this.http.post<EventDetails>(`/api/loot/items/${itemId}/bid`, {});
  }
}
