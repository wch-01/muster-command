import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService, type AdminData, type AdminSettings } from "../services/api.service";

@Component({
  selector: "app-admin-page",
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, AppMenuComponent, SiteFooterComponent],
  templateUrl: "./admin.page.html",
  styleUrls: ["./admin.page.scss"],
})
export class AdminPage implements OnInit {
  data?: AdminData;
  channels: Array<{ id: string; name: string; type: string }> = [];
  saving = false;
  notice = "";
  error = "";

  constructor(private readonly api: ApiService, private readonly changeDetector: ChangeDetectorRef) {}

  ngOnInit() { this.load(); }

  load() {
    this.error = "";
    this.api.getAdmin().subscribe({
      next: (data) => {
        this.data = data;
        this.loadChannels();
        this.changeDetector.detectChanges();
      },
      error: (error) => { this.error = error.error?.error ?? "Admin settings could not be loaded."; this.changeDetector.detectChanges(); },
    });
  }

  loadChannels() {
    this.api.getGuildChannels().subscribe({
      next: ({ channels }) => { this.channels = channels; this.changeDetector.detectChanges(); },
      error: () => { this.channels = []; this.changeDetector.detectChanges(); },
    });
  }

  selected(values: string[], id: string) { return values.includes(id); }
  channelExists(id: string) { return this.channels.some((channel) => channel.id === id); }

  toggle(values: string[], id: string, checked: boolean) {
    if (checked && !values.includes(id)) values.push(id);
    if (!checked) values.splice(values.indexOf(id), 1);
  }

  addManualUser() { this.data?.settings.templateControlUserIds.push(""); }
  removeManualUser(index: number) { this.data?.settings.templateControlUserIds.splice(index, 1); }

  save() {
    if (!this.data) return;
    this.saving = true;
    this.notice = "";
    this.error = "";
    const settings: AdminSettings = {
      ...this.data.settings,
      templateControlUserIds: this.data.settings.templateControlUserIds.map((value) => value.trim()).filter(Boolean),
    };
    this.api.saveAdmin(settings).subscribe({
      next: () => { this.saving = false; this.notice = "Admin settings saved."; this.changeDetector.detectChanges(); },
      error: (error) => { this.saving = false; this.error = error.error?.error ?? "Admin settings could not be saved."; this.changeDetector.detectChanges(); },
    });
  }
}
