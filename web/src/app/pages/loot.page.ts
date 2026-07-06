import { CommonModule, DatePipe } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
} from "@ionic/angular/standalone";
import { ApiService, type EventDetails, type LootItem } from "../services/api.service";

@Component({
  selector: "app-loot-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    RouterLink,
    IonBackButton,
    IonBadge,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/events" />
        </ion-buttons>
        <ion-title>Loot Panel</ion-title>
        <ion-buttons slot="end">
          <ion-button *ngIf="event" [routerLink]="['/events', event.id]">Event</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page-shell split-grid" *ngIf="event">
        <section>
          <ion-card class="compact-card">
            <img *ngIf="event.logoUrl" class="event-logo" [src]="event.logoUrl" [alt]="event.name" />
            <ion-card-header>
              <ion-card-title>{{ event.name }}</ion-card-title>
              <ion-card-subtitle>Loot uses the event ID: {{ event.id }}</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <p *ngIf="event.description">{{ event.description }}</p>
              <p class="muted">
                Loot roll:
                <span *ngIf="raffle?.endsAt">ends {{ raffle?.endsAt | date: "medium" }}</span>
                <span *ngIf="!raffle?.endsAt">end time starts after the event is ended</span>
              </p>
              <ion-input label="Add loot items" labelPlacement="stacked" [(ngModel)]="newItems" placeholder="Gem, Armor, Weapon" />
              <ion-button expand="block" (click)="addItems()" [disabled]="!newItems.trim()">Add items</ion-button>
              <ion-button
                color="secondary"
                expand="block"
                (click)="drawLoot()"
                [disabled]="!event.isOwner || raffle?.status === 'DRAWN'"
              >
                Roll now
              </ion-button>
              <p class="muted" *ngIf="!event.isOwner">Only the event owner can roll this loot pool.</p>
              <p class="muted" *ngIf="error">{{ error }}</p>
            </ion-card-content>
          </ion-card>

          <ion-card class="compact-card">
            <ion-card-header>
              <ion-card-title>Event Members</ion-card-title>
              <ion-card-subtitle>Bid activity highlighted</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                <ion-item class="member-row" *ngFor="let member of event.members">
                  <ion-label [class.bidder]="member.hasBid">
                    {{ member.name }}
                    <p>{{ member.slot }} - {{ member.group }}</p>
                  </ion-label>
                  <ion-badge *ngIf="member.hasBid" color="success">Bid placed</ion-badge>
                </ion-item>
              </ion-list>
            </ion-card-content>
          </ion-card>
        </section>

        <section>
          <div class="toolbar-actions">
            <h1>Loot Items</h1>
            <ion-button size="small" fill="outline" (click)="loadEvent()">Refresh</ion-button>
          </div>
          <div class="list-grid">
            <ion-card class="compact-card" *ngFor="let item of items">
              <ion-card-header>
                <ion-card-title>{{ item.name }}</ion-card-title>
                <ion-card-subtitle>{{ item.bids.length }} bid{{ item.bids.length === 1 ? "" : "s" }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <ion-list lines="none" *ngIf="item.bids.length">
                  <ion-item class="member-row" *ngFor="let bid of item.bids">
                    <ion-label>{{ bid.discordTag }}</ion-label>
                  </ion-item>
                </ion-list>
                <p class="muted" *ngIf="!item.bids.length">No bids yet.</p>
                <p *ngIf="item.winnerTag">Winner: {{ item.winnerTag }}</p>
                <div class="item-actions">
                  <ion-button color="danger" fill="outline" size="small" (click)="removeItem(item)">Remove</ion-button>
                </div>
              </ion-card-content>
            </ion-card>
          </div>
        </section>
      </main>
    </ion-content>
  `,
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
