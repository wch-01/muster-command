import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService, type ActivityGroupInput, type EventTemplateSummary, type SaveTemplateInput, type ScheduleMode } from "../services/api.service";
import { browserTimeZoneLabel, isoToLocalDateTime, localDateTimeToIso } from "../utils/event-time";

type CrewRole = {
  label: string;
  capacity: number;
};

type TemplateGroup = {
  name: string;
  crewCount: number;
  roles: CrewRole[];
};

type TemplateSchedule = {
  clientId: string;
  name: string;
  scheduleMode: ScheduleMode;
  startsAt: string;
  predecessorClientId: string;
  timingNote: string;
};

type TemplateFleet = TemplateSchedule & { ships: TemplateGroup[] };
type TemplateGroundTeam = TemplateSchedule & TemplateGroup;

type TemplateDraft = {
  id?: string;
  name: string;
  createdByName?: string;
  fleets: TemplateFleet[];
  groundTeams: TemplateGroundTeam[];
  lootDurationHours: 24 | 48;
  resourceLootPolicy: EventTemplateSummary["resourceLootPolicy"];
  resourceInstructions: string;
  lootInstructions: string;
  lootAwardMethod: EventTemplateSummary["lootAwardMethod"];
  lootRepeatWinnerMode: EventTemplateSummary["lootRepeatWinnerMode"];
};

@Component({
  selector: "app-templates-page",
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, AppMenuComponent, SiteFooterComponent],
  templateUrl: "./templates.page.html",
  styleUrls: ["./templates.page.scss"],
})
export class TemplatesPage implements OnInit, OnDestroy {
  templates: EventTemplateSummary[] = [];
  loading = true;
  saving = false;
  error = "";
  modalOpen = false;
  editing = false;
  readonly timeZoneLabel = browserTimeZoneLabel();
  draft: TemplateDraft = this.emptyDraft();
  private loadTimeoutId?: number;
  private nextGroupNumber = 1;

  constructor(
    private readonly api: ApiService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadTemplates();
  }

  ngOnDestroy() {
    this.clearLoadTimeout();
  }

  loadTemplates() {
    this.loading = true;
    this.error = "";
    this.clearLoadTimeout();
    this.loadTimeoutId = window.setTimeout(() => {
      if (!this.loading) {
        return;
      }

      this.loading = false;
      this.error = "Templates are taking too long to load. Try again, or create a new template.";
      this.refreshView();
    }, 10_000);

    this.api.listTemplates().subscribe({
      next: ({ templates }) => {
        this.clearLoadTimeout();
        this.templates = templates;
        this.loading = false;
        this.refreshView();
      },
      error: (error) => {
        this.clearLoadTimeout();
        this.error = error?.error?.error ?? "Templates could not be loaded.";
        this.loading = false;
        this.refreshView();
      },
    });
  }

  openCreateModal() {
    this.draft = this.emptyDraft();
    this.editing = true;
    this.error = "";
    this.modalOpen = true;
    this.refreshView();
  }

  openTemplate(template: EventTemplateSummary) {
    this.draft = this.templateToDraft(template);
    this.editing = false;
    this.error = "";
    this.modalOpen = true;
    this.refreshView();
  }

  closeModal() {
    if (this.saving) {
      return;
    }

    this.modalOpen = false;
    this.refreshView();
  }

  saveTemplate() {
    if (this.saving) {
      return;
    }

    let input: SaveTemplateInput;
    try {
      input = this.buildSaveInput();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Enter a valid schedule.";
      return;
    }
    if (!input.name || (!input.slots?.length && !input.groups?.length)) {
      this.error = "Template name and at least one role are required.";
      return;
    }

    this.saving = true;
    this.error = "";
    const request = this.draft.id ? this.api.updateTemplate(this.draft.id, input) : this.api.createTemplate(input);
    request.subscribe({
      next: ({ template }) => {
        const existingIndex = this.templates.findIndex((item) => item.id === template.id);
        if (existingIndex >= 0) {
          this.templates = this.templates.map((item) => (item.id === template.id ? template : item));
        } else {
          this.templates = [...this.templates, template].sort((left, right) => left.name.localeCompare(right.name));
        }
        this.saving = false;
        this.modalOpen = false;
        this.refreshView();
      },
      error: (error) => {
        this.error = error?.error?.error ?? "Template could not be saved.";
        this.saving = false;
        this.refreshView();
      },
    });
  }

  deleteTemplate() {
    if (!this.draft.id || this.saving) {
      return;
    }

    this.saving = true;
    this.error = "";
    this.api.deleteTemplate(this.draft.id).subscribe({
      next: () => {
        this.templates = this.templates.filter((template) => template.id !== this.draft.id);
        this.saving = false;
        this.modalOpen = false;
        this.refreshView();
      },
      error: (error) => {
        this.error = error?.error?.error ?? "Template could not be deleted.";
        this.saving = false;
        this.refreshView();
      },
    });
  }

  addFleet() {
    this.draft.fleets = [...this.draft.fleets, { ...this.scheduleDefaults("FLEET", this.draft.fleets.length), ships: [this.defaultShip(1)] }];
  }

  removeFleet(index: number) {
    const removed = this.draft.fleets[index];
    this.draft.fleets = this.draft.fleets.filter((_, fleetIndex) => fleetIndex !== index);
    this.clearPredecessor(removed?.clientId);
  }

  addShip(fleet: TemplateFleet) {
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

  removeShip(fleet: TemplateFleet, index: number) {
    fleet.ships = fleet.ships.filter((_, shipIndex) => shipIndex !== index);
  }

  addGroundTeam() {
    this.draft.groundTeams = [
      ...this.draft.groundTeams,
      {
        ...this.scheduleDefaults("GROUND", this.draft.groundTeams.length),
        crewCount: 5,
        roles: [
          { label: "Combat", capacity: 4 },
          { label: "Medic", capacity: 1 },
        ],
      },
    ];
  }

  removeGroundTeam(index: number) {
    const removed = this.draft.groundTeams[index];
    this.draft.groundTeams = this.draft.groundTeams.filter((_, teamIndex) => teamIndex !== index);
    this.clearPredecessor(removed?.clientId);
  }

  addRole(group: TemplateGroup, label = "Crew") {
    group.roles = [...group.roles, { label, capacity: 1 }];
  }

  removeRole(group: TemplateGroup, index: number) {
    group.roles = group.roles.filter((_, roleIndex) => roleIndex !== index);
  }

  roleTotal(roles: CrewRole[]) {
    return roles.reduce((total, role) => total + this.safeCapacity(role.capacity), 0);
  }

  slotCount(template: EventTemplateSummary, group: "ship" | "ground") {
    return template.slots
      .filter((slot) => slot.assignmentGroup === group)
      .reduce((total, slot) => total + slot.capacity, 0);
  }

  allDraftGroups(): TemplateSchedule[] {
    return [...this.draft.fleets, ...this.draft.groundTeams];
  }

  predecessorChoices(group: TemplateSchedule) {
    return this.allDraftGroups().filter((candidate) => candidate.clientId !== group.clientId);
  }

  private buildSaveInput(): SaveTemplateInput {
    const groups: ActivityGroupInput[] = [
      ...this.draft.fleets.map((fleet, index) => ({
        clientId: fleet.clientId, kind: "FLEET" as const, name: fleet.name.trim() || `Fleet ${index + 1}`,
        scheduleMode: fleet.scheduleMode, predecessorClientId: fleet.scheduleMode === "AFTER_GROUP" ? fleet.predecessorClientId : undefined,
        startsAt: fleet.scheduleMode === "SPECIFIC_TIME" ? localDateTimeToIso(fleet.startsAt) : undefined,
        timingNote: fleet.timingNote.trim() || undefined,
        ships: fleet.ships.map((ship, shipIndex) => ({ name: ship.name.trim() || `Ship ${shipIndex + 1}`, roles: ship.roles.map((role) => ({ label: role.label.trim() || "Crew", capacity: this.safeCapacity(role.capacity) })) })),
      })),
      ...this.draft.groundTeams.map((team, index) => ({
        clientId: team.clientId, kind: "GROUND" as const, name: team.name.trim() || `Ground Team ${index + 1}`,
        scheduleMode: team.scheduleMode, predecessorClientId: team.scheduleMode === "AFTER_GROUP" ? team.predecessorClientId : undefined,
        startsAt: team.scheduleMode === "SPECIFIC_TIME" ? localDateTimeToIso(team.startsAt) : undefined,
        timingNote: team.timingNote.trim() || undefined,
        roles: team.roles.map((role) => ({ label: role.label.trim() || "Ground Crew", capacity: this.safeCapacity(role.capacity) })),
      })),
    ];

    return {
      name: this.draft.name.trim(),
      lootDurationHours: this.draft.lootDurationHours,
      resourceLootPolicy: this.draft.resourceLootPolicy,
      resourceInstructions: this.draft.resourceInstructions.trim() || undefined,
      lootInstructions: this.draft.lootInstructions.trim() || undefined,
      lootAwardMethod: this.draft.lootAwardMethod,
      lootRepeatWinnerMode: this.draft.lootRepeatWinnerMode,
      groups,
    };
  }

  private templateToDraft(template: EventTemplateSummary): TemplateDraft {
    const clientIds = new Map((template.groups ?? []).map((group) => [group.id, this.newClientId()]));
    return {
      id: template.id,
      name: template.name,
      createdByName: template.createdByName,
      lootDurationHours: template.lootDurationHours === 48 ? 48 : 24,
      resourceLootPolicy: template.resourceLootPolicy,
      resourceInstructions: template.resourceInstructions ?? "",
      lootInstructions: template.lootInstructions ?? "",
      lootAwardMethod: template.lootAwardMethod,
      lootRepeatWinnerMode: template.lootRepeatWinnerMode,
      fleets: this.templateFleets(template, clientIds),
      groundTeams: this.templateGroundTeams(template, clientIds),
    };
  }

  private slotsToGroups(template: EventTemplateSummary, group: "ship" | "ground", fallback: string): TemplateGroup[] {
    const groups = new Map<string, CrewRole[]>();

    for (const slot of template.slots.filter((item) => item.assignmentGroup === group)) {
      const roles = groups.get(slot.category) ?? [];
      roles.push({ label: slot.label, capacity: slot.capacity });
      groups.set(slot.category, roles);
    }

    return Array.from(groups.entries()).map(([name, roles], index) => ({
      name: name || `${fallback} ${index + 1}`,
      crewCount: this.roleTotal(roles),
      roles,
    }));
  }

  private emptyDraft(): TemplateDraft {
    this.nextGroupNumber = 1;
    return {
      name: "",
      lootDurationHours: 24,
      resourceLootPolicy: "ANY",
      resourceInstructions: "",
      lootInstructions: "",
      lootAwardMethod: "FULL_QUANTITY",
      lootRepeatWinnerMode: "DIFFERENT_WINNERS",
      fleets: [{ ...this.scheduleDefaults("FLEET", 0), ships: [this.defaultShip(1)] }],
      groundTeams: [
        {
          ...this.scheduleDefaults("GROUND", 0),
          crewCount: 5,
          roles: [
            { label: "Combat", capacity: 4 },
            { label: "Medic", capacity: 1 },
          ],
        },
      ],
    };
  }

  private templateFleets(template: EventTemplateSummary, ids: Map<string, string>): TemplateFleet[] {
    const fleetGroups = template.groups?.filter((group) => group.kind === "FLEET") ?? [];
    if (!fleetGroups.length) {
      const ships = this.slotsToGroups(template, "ship", "Ship");
      return ships.length ? [{ ...this.scheduleDefaults("FLEET", 0), ships }] : [];
    }
    return fleetGroups.map((group, index) => ({
      clientId: ids.get(group.id)!, name: group.name || `Fleet ${index + 1}`, scheduleMode: group.scheduleMode,
      startsAt: isoToLocalDateTime(group.startsAt), predecessorClientId: group.predecessorGroupId ? ids.get(group.predecessorGroupId) ?? "" : "", timingNote: group.timingNote ?? "",
      ships: this.slotsToGroups({ ...template, slots: template.slots.filter((slot) => slot.groupId === group.id) }, "ship", "Ship"),
    }));
  }

  private templateGroundTeams(template: EventTemplateSummary, ids: Map<string, string>): TemplateGroundTeam[] {
    const groups = template.groups?.filter((group) => group.kind === "GROUND") ?? [];
    if (!groups.length) return this.slotsToGroups(template, "ground", "Ground Team").map((team, index) => ({ ...this.scheduleDefaults("GROUND", index), ...team }));
    return groups.map((group, index) => {
      const roles = template.slots.filter((slot) => slot.groupId === group.id).map((slot) => ({ label: slot.label, capacity: slot.capacity }));
      return { clientId: ids.get(group.id)!, name: group.name || `Ground Team ${index + 1}`, scheduleMode: group.scheduleMode, startsAt: isoToLocalDateTime(group.startsAt),
        predecessorClientId: group.predecessorGroupId ? ids.get(group.predecessorGroupId) ?? "" : "", timingNote: group.timingNote ?? "",
        crewCount: this.roleTotal(roles), roles };
    });
  }

  private scheduleDefaults(kind: "FLEET" | "GROUND", index: number): TemplateSchedule {
    return { clientId: this.newClientId(), name: kind === "FLEET" ? `Fleet ${index + 1}` : `Ground Team ${index + 1}`,
      scheduleMode: kind === "FLEET" && index === 0 ? "EVENT_START" : "AS_DIRECTED", startsAt: "", predecessorClientId: "", timingNote: "" };
  }

  private defaultShip(index: number): TemplateGroup {
    return { name: `Ship ${index}`, crewCount: 4, roles: [{ label: "Pilot", capacity: 1 }, { label: "Crew", capacity: 3 }] };
  }

  private newClientId() { return `template-group-${this.nextGroupNumber++}`; }
  private clearPredecessor(clientId?: string) { if (clientId) for (const group of this.allDraftGroups()) if (group.predecessorClientId === clientId) group.predecessorClientId = ""; }

  private safeCapacity(capacity: number) {
    const value = Number(capacity);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 25) : 1;
  }

  private clearLoadTimeout() {
    if (this.loadTimeoutId) {
      window.clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = undefined;
    }
  }

  private refreshView() {
    this.changeDetector.detectChanges();
  }
}
