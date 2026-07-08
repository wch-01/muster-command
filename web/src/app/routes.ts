import type { Routes } from "@angular/router";
import { EventCreatePage } from "./pages/event-create.page";
import { EventDetailPage } from "./pages/event-detail.page";
import { EventListPage } from "./pages/event-list.page";

export const routes: Routes = [
  { path: "", redirectTo: "active-events", pathMatch: "full" },
  { path: "events", component: EventCreatePage },
  { path: "active-events", component: EventListPage, data: { mode: "active" } },
  { path: "past-events", component: EventListPage, data: { mode: "past" } },
  { path: "events/:id", component: EventDetailPage },
];
