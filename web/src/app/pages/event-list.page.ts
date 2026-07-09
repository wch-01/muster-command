import { CommonModule, DatePipe } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { IonContent } from "@ionic/angular/standalone";
import { Subscription } from "rxjs";
import { AppMenuComponent } from "../components/app-menu.component";
import { EventTabsComponent } from "../components/event-tabs.component";
import { EventDetailPage } from "./event-detail.page";
import { type EventSummary } from "../services/api.service";

@Component({
  selector: "app-event-list-page",
  standalone: true,
  imports: [CommonModule, DatePipe, IonContent, AppMenuComponent, EventTabsComponent, EventDetailPage],
  templateUrl: "./event-list.page.html",
  styleUrls: ["./event-list.page.scss"],
})
export class EventListPage implements OnInit, OnDestroy {
  mode: "active" | "past" = "active";
  events: EventSummary[] = [];
  expandedEventIds = new Set<string>();
  selectedEventId = "";
  selectedEventLootOpen = false;
  error = "";
  private routeSubscription?: Subscription;
  private stream?: EventSource;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.routeSubscription = this.route.data.subscribe((data) => {
      this.mode = data["mode"] === "past" ? "past" : "active";
      this.expandedEventIds.clear();
      this.loadEvents();
      this.syncEventStream();
    });
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.stream?.close();
  }

  async loadEvents() {
    this.error = "";
    this.refreshView();

    try {
      const url = this.mode === "active" ? "/api/events?status=OPEN" : "/api/events?status=CLOSED&mine=yes";
      const response = await fetch(url, { credentials: "same-origin" });
      const body = (await response.json().catch(() => undefined)) as EventSummary[] | { error?: string } | undefined;

      if (!response.ok) {
        this.events = [];
        this.error =
          body && !Array.isArray(body) && body.error
            ? body.error
            : this.mode === "active"
              ? "Could not load active events."
              : "Could not load past events.";
        return;
      }

      this.events = Array.isArray(body) ? body : [];
    } catch (error) {
      this.events = [];
      this.error =
        error instanceof Error
          ? error.message
          : this.mode === "active"
            ? "Could not load active events."
            : "Could not load past events.";
    } finally {
      this.refreshView();
    }
  }

  toggleEvent(eventId: string) {
    if (this.expandedEventIds.has(eventId)) {
      this.expandedEventIds.delete(eventId);
    } else {
      this.expandedEventIds.add(eventId);
    }

    this.refreshView();
  }

  isExpanded(eventId: string) {
    return this.expandedEventIds.has(eventId);
  }

  participantCount(event: EventSummary) {
    const userIds = new Set<string>();
    for (const slot of event.slots) {
      for (const assignment of slot.assignments) {
        userIds.add(assignment.discordUserId);
      }
    }

    return userIds.size;
  }

  openSlots(slot: EventSummary["slots"][number]) {
    return Array.from(
      { length: Math.max(slot.capacity - slot.assignments.length, 0) },
      (_, index) => index + 1,
    );
  }

  copyId(id: string) {
    void navigator.clipboard?.writeText(id);
  }

  openEvent(eventId: string, openLoot = false) {
    this.selectedEventId = eventId;
    this.selectedEventLootOpen = openLoot;
    this.refreshView();
  }

  closeEventModal() {
    this.selectedEventId = "";
    this.selectedEventLootOpen = false;
    this.refreshView();
  }

  private syncEventStream() {
    this.stream?.close();
    this.stream = undefined;

    if (this.mode !== "active") {
      return;
    }

    this.stream = new EventSource("/api/events/stream");
    this.stream.addEventListener("events-changed", () => this.loadEvents());
  }

  private refreshView() {
    this.changeDetector.detectChanges();
  }
}
