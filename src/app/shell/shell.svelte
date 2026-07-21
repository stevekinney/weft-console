<script lang="ts">
  /**
   * Console chrome (plan §13 T1.6): mounted once a client + principal are
   * final (`../app.svelte` owns the bootstrap/API-key-entry sequence ahead
   * of this). `provideClient()`/`providePrincipalStore()` run here, during
   * this component's own initialization — Svelte only allows `setContext`
   * during init, which is exactly why the API-key rebuild flow lives one
   * level up: `<Shell>` itself never remounts once it exists, so context
   * never needs to change after the fact (plan §6, T1.1's `ApiKeyEntry` doc:
   * "the shell owns rebuilding the client … and re-providing context").
   *
   * Keyboard (plan §13 T1.6's "⌘K opens palette, Esc closes overlays"):
   * ⌘K is registered by `./command-palette.svelte`; Esc-closes-overlays is
   * already Cinder's own contract for `CommandPalette` and `Dropdown` (both
   * close on Escape internally) — nothing extra to wire here.
   */
  import { SIDEBAR_MOBILE_MEDIA_QUERY } from '@lostgradient/cinder/sidebar';
  import type { HttpClient } from '@lostgradient/weft/client';
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';

  import { provideClient } from '../../lib/client.ts';
  import type { Principal } from '../../lib/scopes.svelte.ts';
  import { providePrincipalStore } from '../../lib/scopes.svelte.ts';
  import { EngineStatusController } from '../engine-status.svelte.ts';
  import { NotificationStore } from '../notifications.svelte.ts';
  import { ThemeStore } from '../theme.svelte.ts';
  import AuthModeBanner from './auth-mode-banner.svelte';
  import CommandPaletteLauncher from './command-palette.svelte';
  import CriticalAlertStrip from './critical-alert-strip.svelte';
  import RouteOutlet from './route-outlet.svelte';
  import Sidebar from './sidebar.svelte';
  import Topbar from './topbar.svelte';

  interface ShellProps {
    client: HttpClient;
    initialPrincipal: Principal;
  }

  let { client, initialPrincipal }: ShellProps = $props();

  // `client`/`initialPrincipal` are read exactly once, here, at Shell's own
  // initialization — see the module doc: Shell never remounts once these
  // are final, so there is deliberately no reactive dependency on either
  // prop past this point. `untrack()` makes that explicit instead of
  // triggering Svelte's "state referenced locally" warning.
  const { client: initialClient, principal: resolvedPrincipal } = untrack(() => ({
    client,
    principal: initialPrincipal,
  }));

  provideClient(initialClient);
  const principalStore = providePrincipalStore();
  principalStore.setPrincipal(resolvedPrincipal);

  const theme = new ThemeStore();
  const notifications = new NotificationStore();
  const engineStatus = new EngineStatusController(initialClient, notifications);

  $effect(() => {
    return () => engineStatus.dispose();
  });

  /**
   * `collapsed` doubles as "drawer closed" once Cinder's `Sidebar` switches
   * to its mobile presentation below `SIDEBAR_MOBILE_MEDIA_QUERY` (its own
   * internal `open = !collapsed` — `sidebar.svelte`). Left at its plain
   * default of `false`, a mobile page load would render the navigation
   * drawer OPEN over the whole screen with no trigger to close it. Start
   * collapsed on a mobile viewport instead, and re-close whenever the
   * viewport crosses INTO mobile (a live desktop→mobile resize shouldn't
   * leave a rail-expanded desktop session's drawer stuck open either) —
   * never force it back open on mobile→desktop, so a user's manual
   * icon-rail collapse preference on desktop survives.
   */
  const isMobileViewport = new MediaQuery(SIDEBAR_MOBILE_MEDIA_QUERY, false);

  let sidebarCollapsed = $state(isMobileViewport.current);

  $effect(() => {
    if (isMobileViewport.current) sidebarCollapsed = true;
  });

  let paletteOpen = $state(false);
</script>

<div class="weft-shell">
  <Sidebar {client} engineStatus={engineStatus.status} bind:collapsed={sidebarCollapsed} />
  <div class="weft-shell-main">
    <Topbar
      principal={principalStore}
      {notifications}
      liveStatus={engineStatus.fleetSource.status}
      {theme}
      bind:paletteOpen
      bind:sidebarCollapsed
    />
    <AuthModeBanner mode={principalStore.bannerMode} />
    <CriticalAlertStrip store={notifications} />
    <RouteOutlet />
  </div>
</div>

<CommandPaletteLauncher bind:open={paletteOpen} {client} />
