import { CommonModule, DatePipe } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { IonContent } from "@ionic/angular/standalone";
import { Subscription } from "rxjs";
import { AppMenuComponent } from "../components/app-menu.component";
import { EventTabsComponent } from "../components/event-tabs.component";
import { type EventSummary } from "../services/api.service";
import { browserTimeZoneLabel } from "../utils/event-time";

@Component({
  selector: "app-event-list-page",
  standalone: true,
  imports: [CommonModule, DatePipe, IonContent, AppMenuComponent, EventTabsComponent],
  templateUrl: "./event-list.page.html",
  styleUrls: ["./event-list.page.scss"],
})
export class EventListPage implements OnInit, OnDestroy {
  readonly timeZoneLabel = browserTimeZoneLabel();
  @ViewChild(IonContent) private content?: IonContent;
  mode: "active" | "past" = "active";
  events: EventSummary[] = [];
  expandedEventIds = new Set<string>();
  highlightedEventId = "";
  copiedEventId = "";
  error = "";
  private routeSubscription?: Subscription;
  private stream?: EventSource;
  private copiedTimeoutId?: number;
  private restoreListPosition = true;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.routeSubscription = this.route.data.subscribe((data) => {
      this.mode = data["mode"] === "past" ? "past" : "active";
      this.restoreListState();
      this.loadEvents();
      this.syncEventStream();
    });
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.stream?.close();
    if (this.copiedTimeoutId) window.clearTimeout(this.copiedTimeoutId);
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
      void this.restoreScrollPosition();
    }
  }

  toggleEvent(eventId: string) {
    if (this.expandedEventIds.has(eventId)) {
      this.expandedEventIds.delete(eventId);
    } else {
      this.expandedEventIds.add(eventId);
    }

    this.saveExpandedState();
    this.refreshView();
  }

  isExpanded(eventId: string) {
    return this.expandedEventIds.has(eventId);
  }

  activityGroups(event: EventSummary, kind: "FLEET" | "GROUND") {
    return event.groups.filter((group) => group.kind === kind);
  }

  slotsForGroup(event: EventSummary, groupId: string) {
    return event.slots.filter((slot) => slot.groupId === groupId);
  }

  filledSlots(event: EventSummary, kind: "FLEET" | "GROUND") {
    const groupIds = new Set(this.activityGroups(event, kind).map((group) => group.id));
    return event.slots
      .filter((slot) => slot.groupId && groupIds.has(slot.groupId))
      .reduce((total, slot) => total + slot.assignments.length, 0);
  }

  openRoleSlots(event: EventSummary, kind: "FLEET" | "GROUND") {
    const groupIds = new Set(this.activityGroups(event, kind).map((group) => group.id));
    return event.slots
      .filter((slot) => slot.groupId && groupIds.has(slot.groupId))
      .reduce((total, slot) => total + Math.max(slot.capacity - slot.assignments.length, 0), 0);
  }

  groupFilledSlots(event: EventSummary, groupId: string) {
    return this.slotsForGroup(event, groupId).reduce((total, slot) => total + slot.assignments.length, 0);
  }

  groupOpenSlots(event: EventSummary, groupId: string) {
    return this.slotsForGroup(event, groupId)
      .reduce((total, slot) => total + Math.max(slot.capacity - slot.assignments.length, 0), 0);
  }

  fleetShipCount(event: EventSummary, groupId: string) {
    return new Set(this.slotsForGroup(event, groupId).map((slot) => slot.category)).size;
  }

  extraSlots(event: EventSummary) {
    return event.slots.filter((slot) => slot.assignmentGroup === "extra");
  }

  extraFilledSlots(event: EventSummary) {
    return this.extraSlots(event).reduce((total, slot) => total + slot.assignments.length, 0);
  }

  extraOpenSlots(event: EventSummary) {
    return this.extraSlots(event).reduce((total, slot) => total + Math.max(slot.capacity - slot.assignments.length, 0), 0);
  }

  async copyId(id: string) {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(id);
      this.copiedEventId = id;
      if (this.copiedTimeoutId) window.clearTimeout(this.copiedTimeoutId);
      this.copiedTimeoutId = window.setTimeout(() => {
        this.copiedEventId = "";
        this.refreshView();
      }, 1500);
      this.refreshView();
    } catch {
      // Leave the button active when the browser denies clipboard access.
    }
  }

  async openEvent(eventId: string, openLoot = false) {
    await this.saveScrollPosition();
    this.setSessionValue("muster-event-return-highlight", eventId);
    await this.router.navigate(["/events", eventId], {
      queryParams: {
        from: this.mode === "past" ? "past-events" : "active-events",
        loot: openLoot ? "1" : undefined,
      },
    });
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

  private stateKey(name: string) {
    return `muster-event-list:${this.mode}:${name}`;
  }

  private restoreListState() {
    const expanded = this.getSessionValue(this.stateKey("expanded"));
    this.expandedEventIds = new Set(expanded ? expanded.split(",").filter(Boolean) : []);
    this.highlightedEventId = this.getSessionValue("muster-event-return-highlight");
    if (this.highlightedEventId) {
      sessionStorage.removeItem("muster-event-return-highlight");
      window.setTimeout(() => {
        this.highlightedEventId = "";
        this.refreshView();
      }, 3000);
    }
    this.restoreListPosition = true;
  }

  private saveExpandedState() {
    this.setSessionValue(this.stateKey("expanded"), [...this.expandedEventIds].join(","));
  }

  private async saveScrollPosition() {
    const scrollElement = await this.content?.getScrollElement();
    if (scrollElement) {
      this.setSessionValue(this.stateKey("scroll"), String(scrollElement.scrollTop));
    }
  }

  private async restoreScrollPosition() {
    if (!this.restoreListPosition || !this.content) {
      return;
    }
    this.restoreListPosition = false;
    const savedPosition = Number(this.getSessionValue(this.stateKey("scroll")) || 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await this.content.scrollToPoint(0, savedPosition, 0);
  }

  private getSessionValue(key: string) {
    try {
      return sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }

  private setSessionValue(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Browsing remains functional if storage is unavailable.
    }
  }
}
