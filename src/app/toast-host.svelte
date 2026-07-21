<script module lang="ts">
  /**
   * Toast wiring (plan §10.4, §7, T1.5). Frozen after the Phase 1 Foundation
   * gate — see PROJECT-BRIEF "Shared contracts".
   *
   * Cinder's `useToast()` needs a `<ToastRegion>` ancestor and can only be
   * called from a component rendered inside one (`_internal/toast-context.ts`:
   * "Region-scoped state means each `<ToastRegion />` instance is
   * independent" — a deliberate non-singleton design). But `query.ts`'s
   * mutation-error default (plan §4: "mutation error → toast via fault
   * mapping") runs from plain `.ts` with no component tree at all, and this
   * app mounts exactly one `<ToastHost>` for its whole lifetime — a single,
   * permanent region, not the modal-scoped/SSR case Cinder's doc is warning
   * about. This module script is the bridge: the instance below registers
   * its `useToast()` result here once, on mount, and every module — component
   * or plain `.ts` — calls `showToast`/`showFault` instead of `useToast()`
   * directly. This is an app-local composition over `<ToastRegion>` (not a
   * fork or a restyle — PROJECT-BRIEF), needed only because this one caller
   * genuinely has no component context to call `useToast()` from.
   */
  import type { ToastApi, ToastOptions, ToastVariant } from '@lostgradient/cinder/toast-region';

  import {
    FAULT_TREATMENT_TITLE,
    type FaultTreatment,
    type FaultTreatmentKind,
  } from '../lib/faults.ts';

  let toastApi: ToastApi | undefined;

  /** Registered by the mounted `<ToastHost>`'s own attachment below — not meant to be called from other modules. */
  function registerToastApi(next: ToastApi | undefined): void {
    toastApi = next;
  }

  /**
   * Show a toast from anywhere, including a plain `.ts` module with no
   * component context. No-ops (logging a `console.error`, mirroring
   * `useToast()`'s own "a missing region is a programmer error" stance)
   * when called before `<ToastHost>` has mounted.
   */
  export function showToast(message: string, options?: ToastOptions): string | undefined {
    if (!toastApi) {
      console.error('weft-console: showToast() called before <ToastHost> mounted.');
      return undefined;
    }
    return toastApi.show(message, options);
  }

  /** Toast variant per treatment kind — `invalid`/`unauthorized`/`internal` are failures the operator must act on; `not-found`/`conflict`/`not-supported` are lower-stakes state mismatches. */
  const FAULT_TOAST_VARIANT: Readonly<Record<FaultTreatmentKind, ToastVariant>> = {
    'not-found': 'warning',
    conflict: 'warning',
    invalid: 'danger',
    unauthorized: 'danger',
    'not-supported': 'warning',
    internal: 'danger',
  };

  /**
   * Shows a `FaultTreatment` (plan §10.4) as a toast — the generic fallback
   * presentation for a fault with no dedicated inline surface, chiefly
   * `query.ts`'s default mutation `onError`. Surfaces reachable through
   * `<FaultBoundary>` show the same treatment inline instead; this and that
   * are two delivery mechanisms for the same classification, not competing
   * ones.
   */
  export function showFault(treatment: FaultTreatment): string | undefined {
    return showToast(`${FAULT_TREATMENT_TITLE[treatment.kind]}: ${treatment.message}`, {
      variant: FAULT_TOAST_VARIANT[treatment.kind],
    });
  }
</script>

<script lang="ts">
  import ToastRegion, { useToast } from '@lostgradient/cinder/toast-region';

  /*
   * STYLES: this component renders `<ToastRegion>`, which needs
   * `@lostgradient/cinder/toast-region/styles` on the page or it renders
   * unstyled. T1.5 owns no `src/styles/<track>.css` file (PROJECT-BRIEF's
   * per-track CSS convention names one per track; none was named for this
   * task) — the shell/Foundation track (T1.6, `src/styles/foundation.css`,
   * which mounts `<ToastHost>` into the real app shell) is where that import
   * belongs.
   */
</script>

<ToastRegion position="bottom-right">
  {#snippet children()}
    {@const toast = useToast()}
    <span
      hidden
      {@attach () => {
        registerToastApi(toast);
        return () => registerToastApi(undefined);
      }}
    ></span>
  {/snippet}
</ToastRegion>
