import { CommonModule, DatePipe } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
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
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
} from "@ionic/angular/standalone";
import { ApiService, type EventDetails } from "../services/api.service";

@Component({
  selector: "app-event-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
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
    IonChip,
    IonContent,
    IonHeader,
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
        <ion-title>Event</ion-title>
        <ion-buttons slot="end">
          <ion-button *ngIf="event" [routerLink]="['/events', event.id, 'loot']">Loot</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page-shell" *ngIf="event">
        <ion-card class="compact-card">
          <img *ngIf="event.logoUrl" class="event-logo" [src]="event.logoUrl" [alt]="event.name" />
          <ion-card-header>
            <ion-card-title>{{ event.name }}</ion-card-title>
            <ion-card-subtitle>{{ event.startsAt ? (event.startsAt | date: "medium") : "No start time" }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <p *ngIf="event.description">{{ event.description }}</p>
            <p class="muted">Event ID: {{ event.id }}</p>
            <ion-chip>{{ event.status }}</ion-chip>
            <ion-chip>Loot window: {{ event.lootDurationHours }} hours</ion-chip>
            <ion-button [routerLink]="['/events', event.id, 'loot']">Open loot panel</ion-button>
          </ion-card-content>
        </ion-card>

        <section class="list-grid">
          <ion-card class="compact-card">
            <ion-card-header>
              <ion-card-title>Members</ion-card-title>
              <ion-card-subtitle>Highlighted members have bid at least once</ion-card-subtitle>
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
      </main>
    </ion-content>
  `,
})
export class EventDetailPage implements OnInit {
  @Input() id = "";
  event?: EventDetails;

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.api.getEvent(this.id).subscribe((event) => {
      this.event = event;
    });
  }
}
