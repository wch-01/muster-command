import type { Routes } from "@angular/router";
import { EventDetailPage } from "./pages/event-detail.page";
import { EventsPage } from "./pages/events.page";
import { LootPage } from "./pages/loot.page";

export const routes: Routes = [
  { path: "", redirectTo: "events", pathMatch: "full" },
  { path: "events", component: EventsPage },
  { path: "events/:id", component: EventDetailPage },
  { path: "events/:id/loot", component: LootPage },
];
