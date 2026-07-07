import { CommonModule, DatePipe } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { ApiService, type EventDetails, type LootItem } from "../services/api.service";

@Component({
  selector: "app-loot-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    AppMenuComponent,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
  ],
  templateUrl: "./loot.page.html",
  styleUrls: ["./loot.page.scss"],
})
export class LootPage implements OnInit {
  @Input() id = "";
  event?: EventDetails;
  newItems = "";
  error = "";

  constructor(private readonly api: ApiService) {}

  get items(): LootItem[] {
    return this.event?.raffles[0]?.items ?? [];
  }

  get raffle() {
    return this.event?.raffles[0];
  }

  ngOnInit() {
    this.loadEvent();
  }

  loadEvent() {
    this.api.getEvent(this.id).subscribe((event) => {
      this.event = event;
    });
  }

  addItems() {
    this.error = "";
    this.api.addLootItems(this.id, this.newItems).subscribe({
      next: (event) => {
        this.event = event;
        this.newItems = "";
      },
      error: (error) => {
        this.error = error.error?.error ?? "Items could not be added.";
      },
    });
  }

  removeItem(item: LootItem) {
    this.api.removeLootItem(item.id).subscribe((event) => {
      this.event = event;
    });
  }

  drawLoot() {
    this.error = "";
    this.api.drawLoot(this.id).subscribe({
      next: (event) => {
        this.event = event;
      },
      error: (error) => {
        this.error = error.error?.error ?? "Loot could not be rolled.";
      },
    });
  }
}
