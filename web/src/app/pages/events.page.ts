import { CommonModule, DatePipe } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import {
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
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from "@ionic/angular/standalone";
import { ApiService, type CreateEventInput, type EventSummary } from "../services/api.service";

@Component({
  selector: "app-events-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    RouterLink,
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
    IonList,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Star Citizen Events</ion-title>
        <ion-buttons slot="end">
          <ion-button href="/invite">Invite</ion-button>
          <ion-button href="/slash-commands">Commands</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page-shell split-grid">
        <ion-card class="compact-card">
          <ion-card-header>
            <ion-card-title>Create Event</ion-card-title>
            <ion-card-subtitle>Website first, Discord still connected</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <ion-list lines="full">
              <ion-item>
                <ion-input label="Event name" labelPlacement="stacked" [(ngModel)]="form.name" required />
              </ion-item>
              <ion-item>
                <ion-textarea label="Description" labelPlacement="stacked" autoGrow="true" [(ngModel)]="form.description" />
              </ion-item>
              <ion-item>
                <ion-input label="Logo image URL" labelPlacement="stacked" [(ngModel)]="form.logoUrl" />
              </ion-item>
              <ion-item>
                <ion-input label="Start time" labelPlacement="stacked" type="datetime-local" [(ngModel)]="form.startsAt" />
              </ion-item>
              <ion-item>
                <ion-select label="Role preset" labelPlacement="stacked" [(ngModel)]="form.preset">
                  <ion-select-option value="combat-op">Combat op</ion-select-option>
                  <ion-select-option value="ground-team">Ground team</ion-select-option>
                  <ion-select-option value="ship-crew">Ship crew</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-select label="Loot claim window" labelPlacement="stacked" [(ngModel)]="form.lootDurationHours">
                  <ion-select-option [value]="24">24 hours after event end</ion-select-option>
                  <ion-select-option [value]="48">48 hours after event end</ion-select-option>
                </ion-select>
              </ion-item>
            </ion-list>
            <ion-button expand="block" (click)="createEvent()" [disabled]="saving || !form.name.trim()">
              Create event
            </ion-button>
            <p class="muted" *ngIf="error">{{ error }}</p>
          </ion-card-content>
        </ion-card>

        <section>
          <div class="toolbar-actions">
            <h1>Events</h1>
            <ion-button size="small" fill="outline" (click)="loadEvents()">Refresh</ion-button>
          </div>
          <div class="list-grid">
            <ion-card class="compact-card" *ngFor="let event of events">
              <img *ngIf="event.logoUrl" class="event-logo" [src]="event.logoUrl" [alt]="event.name" />
              <ion-card-header>
                <ion-card-title>{{ event.name }}</ion-card-title>
                <ion-card-subtitle>
                  {{ event.startsAt ? (event.startsAt | date: "medium") : "No start time" }}
                </ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <p *ngIf="event.description">{{ event.description }}</p>
                <p class="muted">
                  {{ participantCount(event) }} signed up, {{ lootCount(event) }} loot item{{ lootCount(event) === 1 ? "" : "s" }}
                </p>
                <ion-badge [color]="event.status === 'OPEN' ? 'success' : 'medium'">{{ event.status }}</ion-badge>
                <div class="item-actions">
                  <ion-button size="small" fill="outline" [routerLink]="['/events', event.id]">Event</ion-button>
                  <ion-button size="small" [routerLink]="['/events', event.id, 'loot']">Loot</ion-button>
                </div>
              </ion-card-content>
            </ion-card>
          </div>
        </section>
      </main>
    </ion-content>
  `,
})
export class EventsPage implements OnInit {
  events: EventSummary[] = [];
  saving = false;
  error = "";
  form: CreateEventInput = {
    name: "",
    description: "",
    logoUrl: "",
    startsAt: "",
    preset: "combat-op",
    lootDurationHours: 24,
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.loadEvents();
  }

  loadEvents() {
    this.api.listEvents().subscribe((events) => {
      this.events = events;
    });
  }

  createEvent() {
    this.saving = true;
    this.error = "";
    this.api.createEvent(this.form).subscribe({
      next: (event) => {
        this.api.rememberOwnerKey(event.id, event.ownerKey);
        this.form = {
          name: "",
          description: "",
          logoUrl: "",
          startsAt: "",
          preset: "combat-op",
          lootDurationHours: 24,
        };
        this.saving = false;
        this.loadEvents();
      },
      error: (error) => {
        this.error = error.error?.error ?? "Event could not be created.";
        this.saving = false;
      },
    });
  }

  participantCount(event: EventSummary) {
    return event.slots.reduce((total, slot) => total + slot.assignments.length, 0);
  }

  lootCount(event: EventSummary) {
    return event.raffles.reduce((total, raffle) => total + raffle.items.length, 0);
  }
}
