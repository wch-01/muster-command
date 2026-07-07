import { CommonModule, DatePipe } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { type EventSummary } from "../services/api.service";

@Component({
  selector: "app-event-list-page",
  standalone: true,
  imports: [CommonModule, DatePipe, IonContent, AppMenuComponent],
  templateUrl: "./event-list.page.html",
  styleUrls: ["./event-list.page.scss"],
})
export class EventListPage implements OnInit, OnDestroy {
  mode: "active" | "past" = "active";
  events: EventSummary[] = [];
  error = "";
  private stream?: EventSource;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.mode = this.route.snapshot.data["mode"] === "past" ? "past" : "active";
    this.loadEvents();
    if (this.mode === "active") {
      this.stream = new EventSource("/api/events/stream");
      this.stream.addEventListener("events-changed", () => this.loadEvents());
    }
  }

  ngOnDestroy() {
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

  openSlots(slot: EventSummary["slots"][number]) {
    return Array.from(
      { length: Math.max(slot.capacity - slot.assignments.length, 0) },
      (_, index) => index + 1,
    );
  }

  copyId(id: string) {
    void navigator.clipboard?.writeText(id);
  }

  private refreshView() {
    this.changeDetector.detectChanges();
  }
}
