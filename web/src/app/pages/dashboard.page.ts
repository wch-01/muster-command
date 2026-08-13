import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService, type DashboardServer } from "../services/api.service";
import { browserTimeZoneLabel } from "../utils/event-time";
import { DateTime24Pipe } from "../utils/date-time-24.pipe";

@Component({
  selector: "app-dashboard-page",
  standalone: true,
  imports: [CommonModule, DateTime24Pipe, IonContent, AppMenuComponent, SiteFooterComponent],
  templateUrl: "./dashboard.page.html",
  styleUrls: ["./dashboard.page.scss"],
})
export class DashboardPage implements OnInit, OnDestroy {
  readonly timeZoneLabel = browserTimeZoneLabel();
  servers: DashboardServer[] = [];
  readonly failedServerIcons = new Set<string>();
  error = "";
  botInviteUrl = "/bot-invite";
  private stream?: EventSource;

  constructor(
    private readonly api: ApiService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.api.getSession().subscribe((session) => {
      this.botInviteUrl = session.botInviteUrl ?? "/bot-invite";
      this.changeDetector.detectChanges();
    });
    this.loadDashboard();
    this.stream = new EventSource("/api/events/stream");
    this.stream.addEventListener("events-changed", () => this.loadDashboard());
  }

  ngOnDestroy() {
    this.stream?.close();
  }

  loadDashboard() {
    this.error = "";
    this.api.getDashboard().subscribe({
      next: (dashboard) => {
        this.servers = dashboard.servers;
        this.failedServerIcons.clear();
        this.changeDetector.detectChanges();
      },
      error: (error) => {
        this.error = error.error?.error ?? "Dashboard could not be loaded.";
        this.changeDetector.detectChanges();
      },
    });
  }

  serverIconFailed(serverId: string) {
    this.failedServerIcons.add(serverId);
    this.changeDetector.detectChanges();
  }

  selectServerUrl(serverId: string, returnTo: string) {
    return `/active-server?guildId=${encodeURIComponent(serverId)}&returnTo=${encodeURIComponent(returnTo)}`;
  }

  moreCount(server: DashboardServer) {
    return Math.max(server.activeEventCount - server.activeEvents.length, 0);
  }
}
