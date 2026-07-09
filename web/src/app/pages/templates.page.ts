import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { ApiService, type EventTemplateSummary, type SaveTemplateInput } from "../services/api.service";

type CrewRole = {
  label: string;
  capacity: number;
};

type TemplateGroup = {
  name: string;
  crewCount: number;
  roles: CrewRole[];
};

type TemplateDraft = {
  id?: string;
  name: string;
  createdByName?: string;
  ships: TemplateGroup[];
  groundTeams: TemplateGroup[];
};

@Component({
  selector: "app-templates-page",
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, AppMenuComponent],
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
  draft: TemplateDraft = this.emptyDraft();
  private loadTimeoutId?: number;

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

    const input = this.buildSaveInput();
    if (!input.name || !input.slots.length) {
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

  addShip() {
    this.draft.ships = [
      ...this.draft.ships,
      {
        name: `Ship ${this.draft.ships.length + 1}`,
        crewCount: 4,
        roles: [
          { label: "Pilot", capacity: 1 },
          { label: "Crew", capacity: 3 },
        ],
      },
    ];
  }

  removeShip(index: number) {
    this.draft.ships = this.draft.ships.filter((_, shipIndex) => shipIndex !== index);
  }

  addGroundTeam() {
    this.draft.groundTeams = [
      ...this.draft.groundTeams,
      {
        name: `Ground team ${this.draft.groundTeams.length + 1}`,
        crewCount: 5,
        roles: [
          { label: "Combat", capacity: 4 },
          { label: "Medic", capacity: 1 },
        ],
      },
    ];
  }

  removeGroundTeam(index: number) {
    this.draft.groundTeams = this.draft.groundTeams.filter((_, teamIndex) => teamIndex !== index);
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

  private buildSaveInput(): SaveTemplateInput {
    const slots: SaveTemplateInput["slots"] = [];

    for (const [index, ship] of this.draft.ships.entries()) {
      const category = ship.name.trim() || `Ship ${index + 1}`;
      for (const role of ship.roles) {
        slots.push({
          category,
          assignmentGroup: "ship",
          label: role.label.trim() || "Crew",
          capacity: this.safeCapacity(role.capacity),
        });
      }
    }

    for (const [index, team] of this.draft.groundTeams.entries()) {
      const category = team.name.trim() || `Ground team ${index + 1}`;
      for (const role of team.roles) {
        slots.push({
          category,
          assignmentGroup: "ground",
          label: role.label.trim() || "Ground crew",
          capacity: this.safeCapacity(role.capacity),
        });
      }
    }

    return {
      name: this.draft.name.trim(),
      slots,
    };
  }

  private templateToDraft(template: EventTemplateSummary): TemplateDraft {
    return {
      id: template.id,
      name: template.name,
      createdByName: template.createdByName,
      ships: this.slotsToGroups(template, "ship", "Ship"),
      groundTeams: this.slotsToGroups(template, "ground", "Ground team"),
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
    return {
      name: "",
      ships: [
        {
          name: "Ship 1",
          crewCount: 4,
          roles: [
            { label: "Pilot", capacity: 1 },
            { label: "Crew", capacity: 3 },
          ],
        },
      ],
      groundTeams: [
        {
          name: "Ground team 1",
          crewCount: 5,
          roles: [
            { label: "Combat", capacity: 4 },
            { label: "Medic", capacity: 1 },
          ],
        },
      ],
    };
  }

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
