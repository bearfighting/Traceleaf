import { createBrowserAnalytics } from "@traceleaf/browser";
import { createApp, h, onUnmounted, ref } from "vue";
import { createRouter, createWebHistory, RouterView, RouterLink } from "vue-router";

const events = ref<unknown[]>([]);
const analytics = createBrowserAnalytics({
  siteId: "vue-playground",
  consent: "granted",
  transport: { async sendBatch() {} },
  onNavigation: (event) => events.value.push(event),
});
const Home = { render: () => h("main", [h("h1", "Vue Home")]) };
const User = { render: () => h("main", [h("h1", "Vue User")]) };
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home, meta: { title: "Vue Home" } },
    { path: "/users/42", component: User, meta: { title: "Vue User" } },
  ],
});
router.afterEach((to) => {
  document.title = String(to.meta.title ?? "Vue Playground");
});
const app = createApp({
  setup() {
    onUnmounted(() => analytics.destroy());
    return () =>
      h("div", [
        h("nav", [
          h(RouterLink, { to: "/" }, () => "Home"),
          " | ",
          h(RouterLink, { to: "/users/42" }, () => "User"),
        ]),
        h(RouterView),
        h("pre", { "data-testid": "events" }, JSON.stringify(events.value)),
      ]);
  },
});
app.use(router).mount("#app");
