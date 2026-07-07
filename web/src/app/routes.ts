import type { Routes } from "@angular/router";
import { EventCreatePage } from "./pages/event-create.page";
import { EventDetailPage } from "./pages/event-detail.page";
import { EventListPage } from "./pages/event-list.page";
import { LootHomePage } from "./pages/loot-home.page";
import { LootPage } from "./pages/loot.page";

export const routes: Routes = [
  { path: "", redirectTo: "active-events", pathMatch: "full" },
  { path: "events", component: EventCreatePage },
  { path: "active-events", component: EventListPage, data: { mode: "active" } },
  { path: "past-events", component: EventListPage, data: { mode: "past" } },
  { path: "loot", component: LootHomePage },
  { path: "events/:id", component: EventDetailPage },
  { path: "events/:id/loot", component: LootPage },
];
