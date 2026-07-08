import { CommonModule, DatePipe } from "@angular/common";
import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  IonBadge,
  IonButton,
  IonChip,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { ApiService, type EventDetails, type LootItem } from "../services/api.service";

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
    IonChip,
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
  @Input() id = "";
  groups: AssignmentGroup[] = ["ship", "ground", "extra"];
  event?: EventDetails;
  error = "";
  lootError = "";
  newItems = "";
  lootOpen = false;
  busyAction = "";
  private stream?: EventSource;

  constructor(
    private readonly api: ApiService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
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
