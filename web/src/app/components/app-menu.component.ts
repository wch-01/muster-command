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
    | "dashboard"
    | "active-events"
    | "create-event"
    | "past-events"
    | "commands"
    | "templates"
    | "admin"
    | "system-admin" = "dashboard";

  isSuperAdmin = false;
  userName = "";
  activeServer?: WebSession["activeServer"];
  servers: WebSession["servers"] = [];
  botInviteUrl = "/bot-invite";
  selectedGuildId = "";
  state: WebSession["state"] = "production";
  isDarkMode = false;

  constructor(private readonly api: ApiService) {}

  get eventActive() {
    return this.active === "active-events" || this.active === "create-event" || this.active === "past-events";
  }

  get otherServers() {
    const activeId = this.activeServer?.id;
    return activeId ? this.servers.filter((server) => server.id !== activeId) : this.servers;
  }

  ngOnInit() {
    this.isDarkMode = document.documentElement.dataset["theme"] === "dark";
    if (window.__STARBOT_SESSION__) {
      this.applySession(window.__STARBOT_SESSION__);
    }

    this.api.getSession().subscribe((session) => {
      window.__STARBOT_SESSION__ = session;
      this.applySession(session);
    });
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? "dark" : "light";
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("muster-theme", theme);
  }

  private applySession(session: WebSession) {
      if (session.requiresGuildReconnect) {
        window.location.href = `/auth/discord?returnTo=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      this.isSuperAdmin = session.isSuperAdmin;
      this.state = session.state;
      this.activeServer = session.activeServer;
      this.servers = session.servers;
      this.botInviteUrl = session.botInviteUrl ?? "/bot-invite";
      this.userName = session.activeServer?.userProfile?.displayName ?? session.user.globalName ?? session.user.username;
      this.selectedGuildId = session.activeServer?.id ?? "";
  }

  changeActiveServer(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "__invite") {
      window.location.href = this.botInviteUrl;
      return;
    }

    if (!value || value === this.activeServer?.id) {
      this.selectedGuildId = this.activeServer?.id ?? "";
      return;
    }

    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/active-server?guildId=${encodeURIComponent(value)}&returnTo=${encodeURIComponent(returnTo)}`;
  }
}
