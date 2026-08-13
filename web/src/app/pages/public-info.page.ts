import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { IonContent } from "@ionic/angular/standalone";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService } from "../services/api.service";

@Component({
  selector: "app-public-info-page",
  standalone: true,
  imports: [CommonModule, IonContent, SiteFooterComponent],
  templateUrl: "./public-info.page.html",
  styleUrls: ["./public-info.page.scss"],
})
export class PublicInfoPage implements OnInit {
  page: "about" | "privacy" | "help" = "about";
  isDarkMode = false;
  homeUrl = "/app/login";

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
  ) {}

  ngOnInit() {
    this.page = this.route.snapshot.data["page"] ?? "about";
    this.isDarkMode = document.documentElement.dataset["theme"] === "dark";
    this.api.getSession().subscribe({
      next: () => (this.homeUrl = "/app/dashboard"),
      error: () => (this.homeUrl = "/app/login"),
    });
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? "dark" : "light";
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("muster-theme", theme);
  }
}
