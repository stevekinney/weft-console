<script lang="ts">
  /**
   * Topbar (plan §13 T1.6; design `Weft Console.dc.html` "header"): ⌘K
   * search trigger, scopes pill (links to the System → Scope panel, plan
   * §9.7), notification bell, theme toggle. `router.current.route` drives a
   * lightweight current-domain label — full breadcrumbs are a per-surface
   * concern (workflow/schedule/review detail headers, plan §9.2–§9.5), out
   * of the shell's scope.
   */
  import { Monitor, Moon, Search, Shield, Sun } from 'lucide-svelte';

  import type { PrincipalStore } from '../../lib/scopes.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import type { ThemeStore } from '../theme.svelte.ts';
  import NotificationBell from './notification-bell.svelte';
  import type { NotificationStore } from '../notifications.svelte.ts';

  interface TopbarProps {
    principal: PrincipalStore;
    notifications: NotificationStore;
    theme: ThemeStore;
    paletteOpen: boolean;
  }

  let { principal, notifications, theme, paletteOpen = $bindable(false) }: TopbarProps = $props();

  const DOMAIN_LABELS: Readonly<Record<string, string>> = {
    '/': 'Dashboard',
    '/workflows': 'Workflows',
    '/schedules': 'Schedules',
    '/workers': 'Workers',
    '/reviews': 'Reviews',
    '/storage': 'Storage',
    '/system': 'System',
  };

  const domainLabel = $derived.by(() => {
    const pattern = router.current.route?.pattern;
    if (pattern === undefined) return 'Weft Console';
    const domainPattern = `/${pattern.split('/').filter(Boolean)[0] ?? ''}`;
    return DOMAIN_LABELS[pattern] ?? DOMAIN_LABELS[domainPattern] ?? 'Weft Console';
  });

  const grantedScopeCount = $derived(principal.principal?.scopes.length ?? 0);
  const scopeTitle = $derived(
    principal.principal
      ? `Current scopes: ${principal.principal.scopes.join(', ')}`
      : 'No principal resolved yet',
  );

  const THEME_LABEL = { light: 'Light theme', dark: 'Dark theme', system: 'System theme' } as const;

  function onScopePillClick(event: MouseEvent): void {
    event.preventDefault();
    router.navigate('/system');
  }
</script>

<header class="weft-shell-topbar">
  <span class="weft-shell-topbar__domain">{domainLabel}</span>

  <button type="button" class="weft-shell-search-trigger" onclick={() => (paletteOpen = true)}>
    <Search aria-hidden="true" size={15} />
    <span>Search workflows, schedules, workers…</span>
    <span class="weft-shell-search-trigger__kbd" aria-hidden="true">
      <kbd>⌘</kbd><kbd>K</kbd>
    </span>
  </button>

  <a
    href={router.href('/system')}
    class="weft-shell-scope-pill"
    title={scopeTitle}
    onclick={onScopePillClick}
  >
    <Shield aria-hidden="true" size={13} />
    <span>{grantedScopeCount} scope{grantedScopeCount === 1 ? '' : 's'}</span>
  </a>

  <NotificationBell store={notifications} />

  <button
    type="button"
    class="weft-shell-icon-button"
    aria-label={`Theme: ${THEME_LABEL[theme.mode]}. Activate to switch.`}
    title={THEME_LABEL[theme.mode]}
    onclick={() => theme.cycle()}
  >
    {#if theme.mode === 'light'}
      <Sun aria-hidden="true" size={16} />
    {:else if theme.mode === 'dark'}
      <Moon aria-hidden="true" size={16} />
    {:else}
      <Monitor aria-hidden="true" size={16} />
    {/if}
  </button>
</header>
