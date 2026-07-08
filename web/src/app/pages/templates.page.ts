import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";

@Component({
  selector: "app-templates-page",
  standalone: true,
  imports: [CommonModule, IonContent, AppMenuComponent],
  templateUrl: "./templates.page.html",
  styleUrls: ["./templates.page.scss"],
})
export class TemplatesPage {}
