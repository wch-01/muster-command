import { CommonModule, DatePipe } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
} from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { ApiService, type EventDetails } from "../services/api.service";

@Component({
  selector: "app-event-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    RouterLink,
    AppMenuComponent,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonChip,
    IonContent,
    IonItem,
    IonLabel,
    IonList,
  ],
  templateUrl: "./event-detail.page.html",
  styleUrls: ["./event-detail.page.scss"],
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
