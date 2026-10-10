import { Component, OnDestroy } from "@angular/core";
import { bootstrapApplication, Title } from "@angular/platform-browser";
import { provideRouter, RouterLink, RouterOutlet } from "@angular/router";
import { createBrowserAnalytics } from "@traceleaf/browser";

@Component({ selector: "app-home", standalone: true, template: "<h1>Angular Home</h1>" })
class Home {
  constructor(title: Title) {
    title.setTitle("Angular Home");
  }
}
@Component({ selector: "app-user", standalone: true, template: "<h1>Angular User</h1>" })
class User {
  constructor(title: Title) {
    title.setTitle("Angular User");
  }
}
@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  template:
    '<nav><a routerLink="/">Home</a> | <a routerLink="/users/42">User</a></nav><router-outlet /><pre data-testid="events">{{ events }}</pre>',
})
class App implements OnDestroy {
  events = "[]";
  private analytics = createBrowserAnalytics({
    siteId: "angular-playground",
    consent: "granted",
    transport: { async sendBatch() {} },
    onNavigation: (event) => (this.events = JSON.stringify([...JSON.parse(this.events), event])),
  });
  ngOnDestroy() {
    this.analytics.destroy();
  }
}
bootstrapApplication(App, {
  providers: [
    provideRouter([
      { path: "", component: Home },
      { path: "users/42", component: User },
    ]),
  ],
}).catch((error) => console.error(error));
