import { CommonModule, Location } from "@angular/common";
import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import {
  IonBadge,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService, type EventDetails, type EventGroupSummary, type LootItem, type LootItemInput } from "../services/api.service";
import { browserTimeZoneLabel, formatDateTime24 } from "../utils/event-time";
import { DateTime24Pipe } from "../utils/date-time-24.pipe";

type AssignmentGroup = "ship" | "ground" | "extra";

@Component({
  selector: "app-event-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    DateTime24Pipe,
    FormsModule,
    AppMenuComponent,
    SiteFooterComponent,
    IonBadge,
    IonButton,
    IonContent,
    IonItem,
    IonLabel,
    IonList,
    IonSpinner,
  ],
  templateUrl: "./event-detail.page.html",
  styleUrls: ["./event-detail.page.scss"],
})
export class EventDetailPage implements OnInit, OnDestroy {
  readonly timeZoneLabel = browserTimeZoneLabel();
  @Input() id = "";
  groups: AssignmentGroup[] = ["ship", "ground", "extra"];
  backLabel = "Back to Active Events";
  backPath = "/active-events";
  menuActive = "active-events";
  event?: EventDetails;
  logoLoadFailed = false;
  error = "";
  lootError = "";
  lootDraft: LootItemInput = this.emptyLootDraft();
  editingLootItemId = "";
  lootOpen = false;
  busyAction = "";
  expandedGroups = new Set<string>();
  expandedShips = new Set<string>();
  private stream?: EventSource;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly location: Location,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.configureOrigin();
    this.lootOpen = this.route.snapshot.queryParamMap.get("loot") === "1";
    this.loadEvent();
    this.stream = new EventSource("/api/events/stream");
    this.stream.addEventListener("events-changed", () => this.loadEvent());
  }

  ngOnDestroy() {
    this.stream?.close();
  }

  get raffle() {
    return this.event?.raffles[0];
  }

  get lootItems(): LootItem[] {
    return this.raffle?.items ?? [];
  }

  get bidProgress() {
    return `${this.event?.participantsWithBidCount ?? 0}/${this.event?.participantCount ?? 0}`;
  }

  categoryLabel(category: LootItem["category"]) {
    return ({ RESOURCE: "Resource or material", WEAPON: "Weapon", ARMOR: "Armor", COMPONENT: "Component or equipment", CONSUMABLE: "Consumable", OTHER: "Other" })[category];
  }

  quantityWarning(item: Pick<LootItemInput, "category" | "quantity">) {
    const threshold = item.category === "RESOURCE" ? 100 : 10;
    return Number(item.quantity) > threshold ? `Unusually large quantity (${item.quantity}). Confirm this is correct.` : "";
  }

  resourceWarning(item: Pick<LootItemInput, "category">) {
    return item.category === "RESOURCE" && this.event?.resourceLootPolicy === "NONE"
      ? "This event asks participants not to add resources. You may still save this item."
      : "";
  }

  qualityWarning(item: Pick<LootItemInput, "quality">) {
    if (item.quality === null || item.quality === undefined) return "";
    const quality = Number(item.quality);
    return Number.isInteger(quality) && quality >= 1 && quality <= 1000 ? "" : "Quality must be a whole number from 1 through 1000.";
  }

  lootDraftInvalid() {
    const quantity = Number(this.lootDraft.quantity);
    return !this.lootDraft.name.trim() || !Number.isInteger(quantity) || quantity < 1 || Boolean(this.qualityWarning(this.lootDraft));
  }

  awardSummary(item: LootItem) {
    const totals = new Map<string, { tag: string; quantity: number }>();
    for (const award of item.awards) {
      const current = totals.get(award.discordUserId);
      totals.set(award.discordUserId, { tag: award.discordTag, quantity: (current?.quantity ?? 0) + award.quantity });
    }
    return [...totals.values()].map((award) => `${award.tag}: ${award.quantity}`).join(", ");
  }

  itemAwardDescription() {
    const method = this.event?.lootAwardMethod;
    if (method !== "INDIVIDUAL_UNITS") return "Entire quantity awarded to one winner";
    const repeats = this.event?.lootRepeatWinnerMode;
    return repeats === "ALLOW_REPEATS" ? "Units awarded separately; repeat winners allowed" : "Units awarded separately; different winners when possible";
  }

  get lootEligibilityMessage() {
    switch (this.event?.lootEligibility) {
      case "LOGIN_REQUIRED":
        return "Log in with Discord to use this loot pool.";
      case "PROFILE_UNAVAILABLE":
        return "Select a server where the bot can read your Discord profile before adding loot or bidding.";
      case "NOT_PARTICIPANT":
        return "Join any role in this event before adding loot or bidding.";
      case "POOL_DRAWN":
        return "This loot pool has been drawn and is now closed.";
      case "ALLOWED":
        return "Participants can add loot before or after the event ends, until the pool is drawn.";
      default:
        return "Loot availability could not be determined.";
    }
  }

  loadEvent() {
    this.error = "";
    this.api.getEvent(this.id).subscribe({
      next: (event) => {
        if (event.logoUrl !== this.event?.logoUrl) {
          this.logoLoadFailed = false;
        }
        this.event = event;
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.error = error.error?.error ?? "Event could not be loaded.";
        this.changeDetector.detectChanges();
      },
    });
  }

  groupedSlots(group: AssignmentGroup) {
    return this.event?.slots.filter((slot) => slot.assignmentGroup === group) ?? [];
  }

  activityGroups(kind: "FLEET" | "GROUND") {
    return this.event?.groups.filter((group) => group.kind === kind) ?? [];
  }

  slotsForGroup(groupId: string) {
    return this.event?.slots.filter((slot) => slot.groupId === groupId) ?? [];
  }

  shipsForFleet(groupId: string) {
    return [...new Set(this.slotsForGroup(groupId).map((slot) => slot.category))];
  }

  slotsForShip(groupId: string, shipName: string) {
    return this.slotsForGroup(groupId).filter((slot) => slot.category === shipName);
  }

  groupCapacity(groupId: string) {
    return this.slotsForGroup(groupId).reduce((total, slot) => total + slot.capacity, 0);
  }

  groupAssigned(groupId: string) {
    return this.slotsForGroup(groupId).reduce((total, slot) => total + slot.assignments.length, 0);
  }

  shipCapacity(groupId: string, shipName: string) {
    return this.slotsForShip(groupId, shipName).reduce((total, slot) => total + slot.capacity, 0);
  }

  shipAssigned(groupId: string, shipName: string) {
    return this.slotsForShip(groupId, shipName).reduce((total, slot) => total + slot.assignments.length, 0);
  }

  hasMyActivityAssignment(groupId: string) {
    return this.event?.myAssignmentGroupIds.includes(groupId) ?? false;
  }

  groupConflict(groupId: string) {
    return this.event?.signupConflicts[groupId] ?? "";
  }

  slotConflict(slot: EventDetails["slots"][number]) {
    return slot.groupId ? this.groupConflict(slot.groupId) : "";
  }

  toggleGroup(groupId: string) {
    this.toggleSet(this.expandedGroups, groupId);
  }

  groupExpanded(groupId: string) {
    return this.expandedGroups.has(groupId);
  }

  shipKey(groupId: string, shipName: string) {
    return `${groupId}:${shipName}`;
  }

  toggleShip(groupId: string, shipName: string) {
    this.toggleSet(this.expandedShips, this.shipKey(groupId, shipName));
  }

  shipExpanded(groupId: string, shipName: string) {
    return this.expandedShips.has(this.shipKey(groupId, shipName));
  }

  scheduleDescription(group: EventGroupSummary) {
    if (group.scheduleMode === "EVENT_START") return "At event start";
    if (group.scheduleMode === "SPECIFIC_TIME" && group.startsAt) {
      return formatDateTime24(group.startsAt);
    }
    if (group.scheduleMode === "AFTER_GROUP") {
      const predecessor = this.event?.groups.find((candidate) => candidate.id === group.predecessorGroupId);
      return predecessor ? `After ${predecessor.name}` : "After another group";
    }
    return group.timingNote || "As directed";
  }

  groupTitle(group: AssignmentGroup) {
    if (group === "ship") {
      return "Fleet";
    }

    if (group === "ground") {
      return "Ground";
    }

    return "Extra";
  }

  isExtraLocked() {
    const regularSlots = this.event?.slots.filter((slot) => slot.assignmentGroup !== "extra") ?? [];
    return regularSlots.length > 0 && regularSlots.some((slot) => slot.assignments.length < slot.capacity);
  }

  slotFilled(slot: EventDetails["slots"][number]) {
    return slot.assignments.length >= slot.capacity;
  }

  joinSlot(slot: EventDetails["slots"][number]) {
    this.runEventAction(`join-${slot.id}`, this.api.joinSlot(this.id, slot.id));
  }

  leaveEvent() {
    this.runEventAction("leave", this.api.leaveEvent(this.id));
  }

  backToSource() {
    if (this.event && this.backPath !== "/dashboard") {
      try {
        sessionStorage.setItem("muster-event-return-highlight", this.event.id);
      } catch {
        // Navigation remains functional if storage is unavailable.
      }
    }

    if (window.history.length > 1) {
      this.location.back();
      return;
    }

    void this.router.navigateByUrl(this.backPath);
  }

  private configureOrigin() {
    const source = this.route.snapshot.queryParamMap.get("from");
    if (source === "dashboard") {
      this.backLabel = "Back to Dashboard";
      this.backPath = "/dashboard";
      this.menuActive = "dashboard";
    } else if (source === "past-events") {
      this.backLabel = "Back to Past Events";
      this.backPath = "/past-events";
      this.menuActive = "past-events";
    }
  }

  hasMyAssignment(group: AssignmentGroup) {
    return this.event?.myAssignmentGroups.includes(group) ?? false;
  }

  leaveGroup(group: AssignmentGroup) {
    if (group === "extra") {
      return;
    }
    this.runEventAction(`leave-${group}`, this.api.leaveGroup(this.id, group));
  }

  leaveActivityGroup(group: EventGroupSummary) {
    this.runEventAction(`leave-group-${group.id}`, this.api.leaveActivityGroup(this.id, group.id));
  }

  endEvent() {
    this.runEventAction("end", this.api.endEvent(this.id));
  }

  saveLootItem() {
    this.lootError = "";
    const request = this.editingLootItemId
      ? this.api.updateLootItem(this.id, this.editingLootItemId, this.lootDraft)
      : this.api.addLootItems(this.id, [this.lootDraft]);
    request.subscribe({
      next: (event) => {
        this.event = event;
        this.cancelLootEdit();
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.lootError = error.error?.error ?? "Loot could not be added.";
        this.changeDetector.detectChanges();
      },
    });
  }

  toggleBid(item: LootItem) {
    this.lootError = "";
    this.api.toggleLootBid(this.id, item.id).subscribe({
      next: (event) => {
        this.event = event;
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.lootError = error.error?.error ?? "Bid could not be updated.";
        this.changeDetector.detectChanges();
      },
    });
  }

  removeLootItem(item: LootItem) {
    this.lootError = "";
    this.api.removeLootItem(this.id, item.id).subscribe({
      next: (event) => {
        this.event = event;
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.lootError = error.error?.error ?? "Loot item could not be deleted.";
        this.changeDetector.detectChanges();
      },
    });
  }

  drawLoot() {
    this.lootError = "";
    this.api.drawLoot(this.id).subscribe({
      next: (event) => {
        this.event = event;
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.lootError = error.error?.error ?? "Loot could not be rolled.";
        this.changeDetector.detectChanges();
      },
    });
  }

  private runEventAction(action: string, request: ReturnType<ApiService["joinSlot"]>) {
    this.error = "";
    this.busyAction = action;
    request.subscribe({
      next: (event) => {
        this.event = event;
        this.busyAction = "";
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.error = error.error?.error ?? "Event could not be updated.";
        this.busyAction = "";
        this.changeDetector.detectChanges();
      },
    });
  }

  editLootItem(item: LootItem) {
    this.editingLootItemId = item.id;
    this.lootDraft = {
      name: item.name, category: item.category, quantity: item.quantity, quality: item.quality,
      unit: item.unit,
    };
  }

  cancelLootEdit() {
    this.editingLootItemId = "";
    this.lootDraft = this.emptyLootDraft();
  }

  private emptyLootDraft(): LootItemInput {
    return { name: "", category: "OTHER", quantity: 1, quality: null, unit: null };
  }

  private toggleSet(set: Set<string>, key: string) {
    if (set.has(key)) set.delete(key);
    else set.add(key);
  }
}
