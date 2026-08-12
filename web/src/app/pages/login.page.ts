import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";

type LoginBootstrap = {
  configured: boolean;
  destination: string;
  user?: { username: string; globalName?: string };
};

declare global {
  interface Window { __MUSTER_LOGIN__?: LoginBootstrap; }
}

@Component({
  selector: "app-login-page",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./login.page.html",
  styleUrls: ["./login.page.scss"],
})
export class LoginPage implements OnInit {
  configured = false;
  destination = "/app/dashboard";
  user?: LoginBootstrap["user"];
  isDarkMode = false;

  ngOnInit() {
    const login = window.__MUSTER_LOGIN__;
    this.configured = login?.configured ?? false;
    this.destination = login?.destination ?? "/app/dashboard";
    this.user = login?.user;
    this.isDarkMode = document.documentElement.dataset["theme"] === "dark";
  }

  get loginUrl() { return `/auth/discord?returnTo=${encodeURIComponent(this.destination)}`; }
  get displayName() { return this.user?.globalName ?? this.user?.username ?? ""; }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? "dark" : "light";
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("muster-theme", theme);
  }
}
