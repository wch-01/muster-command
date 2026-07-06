import { provideHttpClient } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideIonicAngular } from "@ionic/angular/standalone";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/routes";

bootstrapApplication(AppComponent, {
  providers: [
    provideIonicAngular(),
    provideHttpClient(),
    provideRouter(routes, withComponentInputBinding()),
  ],
}).catch((error) => console.error(error));
