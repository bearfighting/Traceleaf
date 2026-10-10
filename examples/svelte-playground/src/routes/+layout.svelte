<script lang="ts">
  import { onMount } from "svelte";
  import { createBrowserAnalytics } from "@traceleaf/browser";
  let { children } = $props();
  let events: unknown[] = $state([]);
  onMount(() => {
    const analytics = createBrowserAnalytics({
      siteId: "svelte-playground",
      consent: "granted",
      transport: { async sendBatch() {} },
      onNavigation: (event) => (events = [...events, event]),
    });
    return () => analytics.destroy();
  });
</script>

<nav><a href="/">Home</a> | <a href="/users/42">User</a></nav>
{@render children()}
<pre data-testid="events">{JSON.stringify(events)}</pre>
