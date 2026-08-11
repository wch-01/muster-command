import { CommonModule, DatePipe, Location } from "@angular/common";
import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import {
  IonBadge,
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { ApiService, type EventDetails, type LootItem } from "../services/api.service";
import { browserTimeZoneLabel } from "../utils/event-time";

type AssignmentGroup = "ship" | "ground" | "extra";

@Component({
  selector: "app-event-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    AppMenuComponent,
    IonBadge,
    IonButton,
    IonContent,
    IonInput,
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
  error = "";
  lootError = "";
  newItems = "";
  lootOpen = false;
  busyAction = "";
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

  endEvent() {
    this.runEventAction("end", this.api.endEvent(this.id));
  }

  addLootItems() {
    this.lootError = "";
    this.api.addLootItems(this.id, this.newItems).subscribe({
      next: (event) => {
        this.event = event;
        this.newItems = "";
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
}
