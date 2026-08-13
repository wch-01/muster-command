import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService, type SystemAdminData } from "../services/api.service";

@Component({ selector: "app-system-admin-page", standalone: true, imports: [CommonModule, FormsModule, IonContent, AppMenuComponent, SiteFooterComponent], templateUrl: "./system-admin.page.html", styleUrls: ["./system-admin.page.scss"] })
export class SystemAdminPage implements OnInit {
  data?: SystemAdminData; notice = ""; error = ""; working = false;
  constructor(private readonly api: ApiService, private readonly cd: ChangeDetectorRef) {}
  ngOnInit() { this.load(); }
  load() { this.api.getSystemAdmin().subscribe({ next: data => { this.data=data; this.cd.detectChanges(); }, error: error => { this.error=error.error?.error ?? "System Admin could not be loaded."; this.cd.detectChanges(); } }); }
  duration(seconds?: number) { if (seconds === undefined) return "Not connected"; const d=Math.floor(seconds/86400), h=Math.floor(seconds%86400/3600), m=Math.floor(seconds%3600/60); return [d&&`${d}d`,h&&`${h}h`,m&&`${m}m`].filter(Boolean).join(" ") || "<1m"; }
  register(kind: "guild"|"global") { this.working=true; this.notice=""; this.error=""; const task=kind==="guild"?this.api.registerGuildCommands():this.api.registerGlobalCommands(); task.subscribe({next: result=>{this.working=false;this.notice=result.message;this.load();this.cd.detectChanges();},error:error=>{this.working=false;this.error=error.error?.error??"Command registration failed.";this.cd.detectChanges();}}); }
  saveWebsiteUrl() { if (!this.data) return; this.working=true; this.notice=""; this.error=""; this.api.saveSystemAdmin({publicAppUrl:this.data.publicAppUrl}).subscribe({next:()=>{this.working=false;this.notice="Public website URL saved.";this.load();},error:error=>{this.working=false;this.error=error.error?.error??"Website URL could not be saved.";this.cd.detectChanges();}}); }
}
