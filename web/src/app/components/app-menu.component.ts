import { CommonModule } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { ApiService, type WebSession } from "../services/api.service";

declare global {
  interface Window {
    __STARBOT_SESSION__?: WebSession;
  }
}

@Component({
  selector: "app-menu",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./app-menu.component.html",
  styleUrls: ["./app-menu.component.scss"],
})
export class AppMenuComponent implements OnInit {
  @Input() active:
    | "active-events"
    | "create-event"
    | "past-events"
    | "commands"
    | "admin"
    | "super-admin" = "active-events";

  isSuperAdmin = false;
  userName = "";
  activeServer?: WebSession["activeServer"];
  servers: WebSession["servers"] = [];

  constructor(private readonly api: ApiService) {}

  get eventActive() {
    return this.active === "active-events" || this.active === "create-event" || this.active === "past-events";
  }

  ngOnInit() {
    if (window.__STARBOT_SESSION__) {
      this.applySession(window.__STARBOT_SESSION__);
    }

    this.api.getSession().subscribe((session) => {
      window.__STARBOT_SESSION__ = session;
      this.applySession(session);
    });
  }

  private applySession(session: WebSession) {
      if (session.requiresGuildReconnect) {
        window.location.href = `/auth/discord?returnTo=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      this.isSuperAdmin = session.isSuperAdmin;
      this.activeServer = session.activeServer;
      this.servers = session.servers;
      this.userName = session.activeServer?.userProfile?.displayName ?? session.user.globalName ?? session.user.username;
      if (session.requiresServerSetup) {
        window.location.href = "/admin";
      }
  }
}
