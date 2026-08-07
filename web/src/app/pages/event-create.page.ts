import { CommonModule, DatePipe } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonToggle,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { EventTabsComponent } from "../components/event-tabs.component";
import { ApiService, type CreatedEventDetails, type CreateEventInput, type EventTemplateSummary } from "../services/api.service";

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
  type: string;
  crewCount: number;
  roles: CrewRole[];
};

type GroundTeamGroup = {
  name: string;
  crewCount: number;
  roles: CrewRole[];
};

@Component({
  selector: "app-event-create-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    AppMenuComponent,
    EventTabsComponent,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonInput,
    IonItem,
    IonList,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonToggle,
  ],
  templateUrl: "./event-create.page.html",
  styleUrls: ["./event-create.page.scss"],
})
export class EventCreatePage implements OnInit {
  saving = false;
  error = "";
  createdEvent?: { id: string; name: string; activeServerName?: string };
  allowExtraCrew = false;
  extraCrewCapacity = 25;
  ships: ShipGroup[] = [];
  groundTeams: GroundTeamGroup[] = [];
  templates: EventTemplateSummary[] = [];
  form: CreateEventInput = {
    name: "",
    description: "",
    logoUrl: "",
    startsAt: "",
    preset: "combat-op",
    lootDurationHours: 24,
  };

  constructor(
    private readonly api: ApiService,
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

    const input = {
      ...this.form,
      preset: "custom",
      customSlots: this.customSlotsForSubmit(),
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
      };
      this.applyTemplate(this.form.preset);
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
    return this.ships.flatMap((ship) => ship.roles);
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

  addShip() {
    this.ships = [
      ...this.ships,
      {
        type: `Ship ${this.ships.length + 1}`,
        crewCount: 4,
        roles: [
          { label: "Pilot", capacity: 1 },
          { label: "Crew", capacity: 3 },
        ],
      },
    ];
  }

  removeShip(index: number) {
    this.ships = this.ships.filter((_, shipIndex) => shipIndex !== index);
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
        name: `Ground team ${this.groundTeams.length + 1}`,
        crewCount: 5,
        roles: [
          { label: "Combat", capacity: 4 },
          { label: "Medic", capacity: 1 },
        ],
      },
    ];
  }

  removeGroundTeam(index: number) {
    this.groundTeams = this.groundTeams.filter((_, teamIndex) => teamIndex !== index);
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

  private applyTemplate(preset: string) {
    if (preset === "custom") {
      this.ships = [
        {
          type: "Ship 1",
          crewCount: 4,
          roles: [
            { label: "Pilot", capacity: 1 },
            { label: "Crew", capacity: 3 },
          ],
        },
      ];
      this.groundTeams = [
        {
          name: "Ground team 1",
          crewCount: 5,
          roles: [
            { label: "Combat", capacity: 4 },
            { label: "Medic", capacity: 1 },
          ],
        },
      ];
      return;
    }

    const template = this.templates.find((item) => item.id === preset);
    if (template) {
      this.applyTemplateSlots(template);
      return;
    }

    this.ships = [
      {
        type: "Capital ship 1",
        crewCount: 5,
        roles: [
          { label: "Big ship captain", capacity: 1 },
          { label: "Gunner", capacity: 2 },
          { label: "Fighter pilot", capacity: 2 },
        ],
      },
    ];
    this.groundTeams = [
      {
        name: "Ground team 1",
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

  private applyTemplateSlots(template: EventTemplateSummary) {
    const shipGroups = new Map<string, CrewRole[]>();
    const groundGroups = new Map<string, CrewRole[]>();

    for (const slot of template.slots) {
      const target = slot.assignmentGroup === "ground" ? groundGroups : shipGroups;
      const roles = target.get(slot.category) ?? [];
      roles.push({ label: slot.label, capacity: slot.capacity });
      target.set(slot.category, roles);
    }

    this.ships = Array.from(shipGroups.entries()).map(([type, roles], index) => ({
      type: type || `Ship ${index + 1}`,
      crewCount: this.roleTotal(roles),
      roles,
    }));
    this.groundTeams = Array.from(groundGroups.entries()).map(([name, roles], index) => ({
      name: name || `Ground team ${index + 1}`,
      crewCount: this.roleTotal(roles),
      roles,
    }));
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

    for (const [shipIndex, ship] of this.ships.entries()) {
      const category = ship.type.trim() || `Ship ${shipIndex + 1}`;
      for (const role of ship.roles) {
        slots.push({
          category,
          group: "ship",
          label: role.label.trim() || "Crew",
          capacity: this.safeCapacity(role.capacity),
        });
      }
    }

    for (const [teamIndex, team] of this.groundTeams.entries()) {
      const category = team.name.trim() || `Ground team ${teamIndex + 1}`;
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

  private customSlotsForSubmit() {
    return this.buildSlots()
      .map((slot) => `${slot.label}:${slot.capacity}:${slot.category}:${slot.group}`)
      .join("; ");
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
