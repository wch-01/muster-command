import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { EventTabsComponent } from "../components/event-tabs.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { LocalDateTimeInputComponent } from "../components/local-date-time-input.component";
import {
  ApiService,
  type ActivityGroupInput,
  type CreatedEventDetails,
  type CreateEventInput,
  type EventTemplateSummary,
  type ScheduleMode,
} from "../services/api.service";
import { browserTimeZoneLabel, isoToLocalDateTime, localDateTimeToIso } from "../utils/event-time";
import { DateTime24Pipe } from "../utils/date-time-24.pipe";

type AssignmentGroup = "ship" | "ground" | "extra";

type RoleTemplate = {
  category: string;
  group: AssignmentGroup;
  label: string;
  capacity: number;
};

type CrewRole = {
  label: string;
  capacity: number;
};

type ShipGroup = {
  name: string;
  crewCount: number;
  roles: CrewRole[];
};

type ScheduleFields = {
  clientId: string;
  name: string;
  scheduleMode: ScheduleMode;
  startsAt: string;
  predecessorClientId: string;
  timingNote: string;
};

type FleetGroup = ScheduleFields & {
  ships: ShipGroup[];
};

type GroundTeamGroup = ScheduleFields & {
  crewCount: number;
  roles: CrewRole[];
};

@Component({
  selector: "app-event-create-page",
  standalone: true,
  imports: [
    CommonModule,
    DateTime24Pipe,
    FormsModule,
    LocalDateTimeInputComponent,
    AppMenuComponent,
    EventTabsComponent,
    SiteFooterComponent,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
  ],
  templateUrl: "./event-create.page.html",
  styleUrls: ["./event-create.page.scss"],
})
export class EventCreatePage implements OnInit {
  readonly timeZoneLabel = browserTimeZoneLabel();
  saving = false;
  error = "";
  createdEvent?: { id: string; name: string; activeServerName?: string };
  allowExtraCrew = false;
  extraCrewCapacity = 25;
  fleets: FleetGroup[] = [];
  groundTeams: GroundTeamGroup[] = [];
  templates: EventTemplateSummary[] = [];
  private nextGroupNumber = 1;
  form: CreateEventInput = {
    name: "",
    description: "",
    logoUrl: "",
    startsAt: "",
    preset: "combat-op",
    lootDurationHours: 24,
    resourceLootPolicy: "ANY",
    resourceInstructions: "",
    lootInstructions: "",
    lootAwardMethod: "FULL_QUANTITY",
    lootRepeatWinnerMode: "DIFFERENT_WINNERS",
  };

  constructor(
    private readonly api: ApiService,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.applyTemplate("combat-op");
  }

  ngOnInit() {
    this.loadTemplates();
  }

  get selectedTemplateRoles() {
    return this.templateRoles(this.form.preset);
  }

  async createEvent() {
    if (this.saving) {
      return;
    }

    let startsAt: string | undefined;
    try {
      startsAt = localDateTimeToIso(this.form.startsAt ?? "");
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Enter a valid event start time.";
      return;
    }

    let groups: ActivityGroupInput[];
    try {
      groups = this.groupsForSubmit();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Check the fleet and ground-team schedules.";
      return;
    }

    const input = {
      ...this.form,
      startsAt,
      preset: "custom",
      groups,
      extraCrewCapacity: this.allowExtraCrew ? this.safeCapacity(this.extraCrewCapacity) : undefined,
    };
    this.saving = true;
    this.error = "";
    this.createdEvent = undefined;
    this.refreshView();

    try {
      const event = await this.createEventRequest(input);
      const eventId = typeof event?.id === "string" ? event.id : "";
      if (!eventId) {
        this.error = "The server created the event but did not return its ID.";
        return;
      }

      const eventName = typeof event.name === "string" && event.name.trim() ? event.name : input.name.trim();
      this.createdEvent = { id: eventId, name: eventName || "Untitled event" };
      this.form = {
        name: "",
        description: "",
        logoUrl: "",
        startsAt: "",
        preset: this.defaultTemplateId() ?? "combat-op",
        lootDurationHours: 24,
        resourceLootPolicy: "ANY",
        resourceInstructions: "",
        lootInstructions: "",
        lootAwardMethod: "FULL_QUANTITY",
        lootRepeatWinnerMode: "DIFFERENT_WINNERS",
      };
      this.applyTemplate(this.form.preset);
      await this.router.navigate(["/events", eventId], {
        queryParams: { from: "active-events", created: "1" },
      });
    } catch (error) {
      console.error("Create event failed:", error);
      this.error = error instanceof Error ? error.message : "Event could not be created.";
    } finally {
      this.saving = false;
      this.refreshView();
    }
  }

  private async createEventRequest(input: CreateEventInput) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Partial<CreatedEventDetails> & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Event could not be created.");
      }

      return body as CreatedEventDetails;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Create event timed out. The event may have been created; check Active Events before trying again.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private refreshView() {
    this.changeDetector.detectChanges();
  }

  previewSlots() {
    return this.buildSlots();
  }

  shipRoles() {
    return this.fleets.flatMap((fleet) => fleet.ships).flatMap((ship) => ship.roles);
  }

  groundRoles() {
    return this.groundTeams.flatMap((team) => team.roles);
  }

  groupedPreviewSlots(group: AssignmentGroup) {
    return this.previewSlots().filter((slot) => slot.group === group);
  }

  hasPreviewGroup(group: AssignmentGroup) {
    return this.groupedPreviewSlots(group).length > 0;
  }

  presetChanged() {
    this.applyTemplate(this.form.preset);
  }

  private loadTemplates() {
    this.api.listTemplates().subscribe({
      next: ({ templates }) => {
        this.templates = templates;
        const defaultTemplateId = this.defaultTemplateId();
        if (defaultTemplateId && this.form.preset === "combat-op") {
          this.form.preset = defaultTemplateId;
          this.applyTemplate(defaultTemplateId);
        }
      },
      error: (error) => {
        console.warn("Could not load event templates:", error);
      },
    });
  }

  addFleet() {
    this.fleets = [
      ...this.fleets,
      {
        ...this.scheduleDefaults("FLEET", this.fleets.length),
        ships: [this.defaultShip(1)],
      },
    ];
  }

  removeFleet(index: number) {
    const removed = this.fleets[index];
    this.fleets = this.fleets.filter((_, fleetIndex) => fleetIndex !== index);
    this.clearRemovedPredecessor(removed?.clientId);
  }

  addShip(fleet: FleetGroup) {
    fleet.ships = [
      ...fleet.ships,
      {
        name: `Ship ${fleet.ships.length + 1}`,
        crewCount: 4,
        roles: [
          { label: "Pilot", capacity: 1 },
          { label: "Crew", capacity: 3 },
        ],
      },
    ];
  }

  removeShip(fleet: FleetGroup, index: number) {
    fleet.ships = fleet.ships.filter((_, shipIndex) => shipIndex !== index);
  }

  addShipRole(ship: ShipGroup) {
    ship.roles = [...ship.roles, { label: "Crew", capacity: 1 }];
  }

  removeShipRole(ship: ShipGroup, index: number) {
    ship.roles = ship.roles.filter((_, roleIndex) => roleIndex !== index);
  }

  addGroundTeam() {
    this.groundTeams = [
      ...this.groundTeams,
      {
        ...this.scheduleDefaults("GROUND", this.groundTeams.length),
        crewCount: 5,
        roles: [
          { label: "Combat", capacity: 4 },
          { label: "Medic", capacity: 1 },
        ],
      },
    ];
  }

  removeGroundTeam(index: number) {
    const removed = this.groundTeams[index];
    this.groundTeams = this.groundTeams.filter((_, teamIndex) => teamIndex !== index);
    this.clearRemovedPredecessor(removed?.clientId);
  }

  addGroundRole(team: GroundTeamGroup) {
    team.roles = [...team.roles, { label: "Combat", capacity: 1 }];
  }

  removeGroundRole(team: GroundTeamGroup, index: number) {
    team.roles = team.roles.filter((_, roleIndex) => roleIndex !== index);
  }

  roleTotal(roles: CrewRole[]) {
    return roles.reduce((total, role) => total + this.safeCapacity(role.capacity), 0);
  }

  allActivityGroups(): ScheduleFields[] {
    return [...this.fleets, ...this.groundTeams];
  }

  predecessorChoices(group: ScheduleFields) {
    return this.allActivityGroups().filter((candidate) => candidate.clientId !== group.clientId);
  }

  scheduleDescription(group: ScheduleFields) {
    if (group.scheduleMode === "EVENT_START") return "At event start";
    if (group.scheduleMode === "SPECIFIC_TIME") {
      return group.startsAt ? `${group.startsAt.replace("T", " ")} (${this.timeZoneLabel})` : "Specific time not set";
    }
    if (group.scheduleMode === "AFTER_GROUP") {
      const predecessor = this.allActivityGroups().find((item) => item.clientId === group.predecessorClientId);
      return predecessor ? `After ${predecessor.name}` : "Preceding group not selected";
    }
    return group.timingNote.trim() || "As directed";
  }

  private applyTemplate(preset: string) {
    if (preset === "custom") {
      this.resetDefaultGroups();
      return;
    }

    const template = this.templates.find((item) => item.id === preset);
    if (template) {
      this.applyTemplateSlots(template);
      this.form.lootDurationHours = template.lootDurationHours;
      this.form.resourceLootPolicy = template.resourceLootPolicy;
      this.form.resourceInstructions = template.resourceInstructions ?? "";
      this.form.lootInstructions = template.lootInstructions ?? "";
      this.form.lootAwardMethod = template.lootAwardMethod;
      this.form.lootRepeatWinnerMode = template.lootRepeatWinnerMode;
      return;
    }

    this.fleets = [
      {
        ...this.scheduleDefaults("FLEET", 0),
        ships: [
          {
            name: "Capital Ship 1",
            crewCount: 5,
            roles: [
              { label: "Big ship captain", capacity: 1 },
              { label: "Gunner", capacity: 2 },
              { label: "Fighter pilot", capacity: 2 },
            ],
          },
        ],
      },
    ];
    this.groundTeams = [
      {
        ...this.scheduleDefaults("GROUND", 0),
        crewCount: 6,
        roles: [
          { label: "Combat heavy", capacity: 1 },
          { label: "Combat", capacity: 3 },
          { label: "Medic", capacity: 1 },
          { label: "Industrialist", capacity: 1 },
        ],
      },
    ];
  }

  private resetDefaultGroups() {
    this.nextGroupNumber = 1;
    this.fleets = [{ ...this.scheduleDefaults("FLEET", 0), ships: [this.defaultShip(1)] }];
    this.groundTeams = [
      {
        ...this.scheduleDefaults("GROUND", 0),
        crewCount: 5,
        roles: [
          { label: "Combat", capacity: 4 },
          { label: "Medic", capacity: 1 },
        ],
      },
    ];
  }

  private applyTemplateSlots(template: EventTemplateSummary) {
    if (!template.groups?.length) {
      this.applyLegacyTemplateSlots(template);
      return;
    }

    const clientIds = new Map(template.groups.map((group) => [group.id, this.newClientId()]));
    this.fleets = template.groups
      .filter((group) => group.kind === "FLEET")
      .map((group, fleetIndex) => {
        const shipRoles = new Map<string, CrewRole[]>();
        for (const slot of template.slots.filter((item) => item.groupId === group.id)) {
          const roles = shipRoles.get(slot.category) ?? [];
          roles.push({ label: slot.label, capacity: slot.capacity });
          shipRoles.set(slot.category, roles);
        }
        return {
          clientId: clientIds.get(group.id)!,
          name: group.name || `Fleet ${fleetIndex + 1}`,
          scheduleMode: group.scheduleMode,
          startsAt: isoToLocalDateTime(group.startsAt),
          predecessorClientId: group.predecessorGroupId ? clientIds.get(group.predecessorGroupId) ?? "" : "",
          timingNote: group.timingNote ?? "",
          ships: [...shipRoles].map(([name, roles], shipIndex) => ({
            name: name || `Ship ${shipIndex + 1}`,
            crewCount: this.roleTotal(roles),
            roles,
          })),
        };
      });

    this.groundTeams = template.groups
      .filter((group) => group.kind === "GROUND")
      .map((group, teamIndex) => {
        const roles = template.slots
          .filter((item) => item.groupId === group.id)
          .map((slot) => ({ label: slot.label, capacity: slot.capacity }));
        return {
          clientId: clientIds.get(group.id)!,
          name: group.name || `Ground Team ${teamIndex + 1}`,
          scheduleMode: group.scheduleMode,
          startsAt: isoToLocalDateTime(group.startsAt),
          predecessorClientId: group.predecessorGroupId ? clientIds.get(group.predecessorGroupId) ?? "" : "",
          timingNote: group.timingNote ?? "",
          crewCount: this.roleTotal(roles),
          roles,
        };
      });

    if (!this.fleets.length && !this.groundTeams.length) this.resetDefaultGroups();
  }

  private applyLegacyTemplateSlots(template: EventTemplateSummary) {
    const shipGroups = new Map<string, CrewRole[]>();
    const groundGroups = new Map<string, CrewRole[]>();
    for (const slot of template.slots) {
      const target = slot.assignmentGroup === "ground" ? groundGroups : shipGroups;
      const roles = target.get(slot.category) ?? [];
      roles.push({ label: slot.label, capacity: slot.capacity });
      target.set(slot.category, roles);
    }
    this.fleets = shipGroups.size
      ? [{
          ...this.scheduleDefaults("FLEET", 0),
          ships: [...shipGroups].map(([name, roles], index) => ({
            name: name || `Ship ${index + 1}`,
            crewCount: this.roleTotal(roles),
            roles,
          })),
        }]
      : [];
    this.groundTeams = [
      ...[...groundGroups].map(([name, roles], index) => ({
      ...this.scheduleDefaults("GROUND", index),
      name: name || `Ground Team ${index + 1}`,
      crewCount: this.roleTotal(roles),
      roles,
      }))
    ];
  }

  private defaultTemplateId() {
    return this.templates.find((template) => template.name.toLowerCase() === "combat op")?.id ?? this.templates[0]?.id;
  }

  private templateRoles(preset: string): RoleTemplate[] {
    const presets: Record<string, RoleTemplate[]> = {
      "combat-op": [
        { category: "Fleet", group: "ship", label: "Big ship captain", capacity: 1 },
        { category: "Fleet", group: "ship", label: "Gunner", capacity: 2 },
        { category: "Fleet", group: "ship", label: "Fighter pilot", capacity: 2 },
        { category: "Ground team", group: "ground", label: "Combat heavy", capacity: 1 },
        { category: "Ground team", group: "ground", label: "Combat", capacity: 3 },
        { category: "Ground team", group: "ground", label: "Medic", capacity: 1 },
        { category: "Ground team", group: "ground", label: "Industrialist", capacity: 1 },
      ],
      custom: [],
    };

    const template = this.templates.find((item) => item.id === preset);
    if (template) {
      return template.slots.map((slot) => ({
        category: slot.category,
        group: slot.assignmentGroup,
        label: slot.label,
        capacity: slot.capacity,
      }));
    }

    return presets[preset] ?? presets["combat-op"];
  }

  private buildSlots() {
    const slots: RoleTemplate[] = [];

    for (const fleet of this.fleets) {
      for (const [shipIndex, ship] of fleet.ships.entries()) {
        const category = ship.name.trim() || `Ship ${shipIndex + 1}`;
        for (const role of ship.roles) {
          slots.push({
            category,
            group: "ship",
            label: role.label.trim() || "Crew",
            capacity: this.safeCapacity(role.capacity),
          });
        }
      }
    }

    for (const [teamIndex, team] of this.groundTeams.entries()) {
      const category = team.name.trim() || `Ground Team ${teamIndex + 1}`;
      for (const role of team.roles) {
        slots.push({
          category,
          group: "ground",
          label: role.label.trim() || "Ground crew",
          capacity: this.safeCapacity(role.capacity),
        });
      }
    }

    if (this.allowExtraCrew) {
      slots.push({
        category: "Extra Crew",
        group: "extra",
        label: "Extra Crew",
        capacity: this.extraCrewCapacity,
      });
    }

    return slots;
  }

  private groupsForSubmit(): ActivityGroupInput[] {
    return [...this.fleets.map((fleet, index) => ({
      clientId: fleet.clientId,
      kind: "FLEET" as const,
      name: fleet.name.trim() || `Fleet ${index + 1}`,
      ...this.scheduleForSubmit(fleet),
      ships: fleet.ships.map((ship, shipIndex) => ({
        name: ship.name.trim() || `Ship ${shipIndex + 1}`,
        roles: ship.roles.map((role) => ({
          label: role.label.trim() || "Crew",
          capacity: this.safeCapacity(role.capacity),
        })),
      })),
    })), ...this.groundTeams.map((team, index) => ({
      clientId: team.clientId,
      kind: "GROUND" as const,
      name: team.name.trim() || `Ground Team ${index + 1}`,
      ...this.scheduleForSubmit(team),
      roles: team.roles.map((role) => ({
        label: role.label.trim() || "Ground Crew",
        capacity: this.safeCapacity(role.capacity),
      })),
    }))];
  }

  private scheduleForSubmit(group: ScheduleFields) {
    return {
      scheduleMode: group.scheduleMode,
      startsAt: group.scheduleMode === "SPECIFIC_TIME" ? localDateTimeToIso(group.startsAt) : undefined,
      predecessorClientId: group.scheduleMode === "AFTER_GROUP" ? group.predecessorClientId || undefined : undefined,
      timingNote: group.timingNote.trim() || undefined,
    };
  }

  private scheduleDefaults(kind: "FLEET" | "GROUND", index: number): ScheduleFields {
    return {
      clientId: this.newClientId(),
      name: kind === "FLEET" ? `Fleet ${index + 1}` : `Ground Team ${index + 1}`,
      scheduleMode: kind === "FLEET" && index === 0 ? "EVENT_START" : "AS_DIRECTED",
      startsAt: "",
      predecessorClientId: "",
      timingNote: "",
    };
  }

  private defaultShip(index: number): ShipGroup {
    return {
      name: `Ship ${index}`,
      crewCount: 4,
      roles: [
        { label: "Pilot", capacity: 1 },
        { label: "Crew", capacity: 3 },
      ],
    };
  }

  private newClientId() {
    return `group-${this.nextGroupNumber++}`;
  }

  private clearRemovedPredecessor(clientId?: string) {
    if (!clientId) return;
    for (const group of this.allActivityGroups()) {
      if (group.predecessorClientId === clientId) group.predecessorClientId = "";
    }
  }

  private safeCapacity(capacity: number) {
    const value = Number(capacity);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 25) : 1;
  }

  emptySlots(capacity: number) {
    return Array.from({ length: capacity }, (_, index) => index + 1);
  }

  copyId(id: string) {
    void navigator.clipboard?.writeText(id);
  }
}
