import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
  selector: "app-event-tabs",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./event-tabs.component.html",
  styleUrls: ["./event-tabs.component.scss"],
})
export class EventTabsComponent {
  @Input() active: "active-events" | "past-events" | "create-event" = "active-events";
}
