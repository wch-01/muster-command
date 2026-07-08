import type { Routes } from "@angular/router";
import { DashboardPage } from "./pages/dashboard.page";
import { EventCreatePage } from "./pages/event-create.page";
import { EventDetailPage } from "./pages/event-detail.page";
import { EventListPage } from "./pages/event-list.page";
import { TemplatesPage } from "./pages/templates.page";

export const routes: Routes = [
  { path: "", redirectTo: "dashboard", pathMatch: "full" },
  { path: "dashboard", component: DashboardPage },
  { path: "events", component: EventCreatePage },
  { path: "active-events", component: EventListPage, data: { mode: "active" } },
  { path: "past-events", component: EventListPage, data: { mode: "past" } },
  { path: "events/:id", component: EventDetailPage },
  { path: "templates", component: TemplatesPage },
];
