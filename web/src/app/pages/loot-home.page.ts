import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";

@Component({
  selector: "app-loot-home-page",
  standalone: true,
  imports: [CommonModule, IonContent, AppMenuComponent],
  templateUrl: "./loot-home.page.html",
  styleUrls: ["./loot-home.page.scss"],
})
export class LootHomePage {}
