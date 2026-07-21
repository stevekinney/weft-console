<script lang="ts">
  /**
   * Logs tab (plan T2.5, §9.2: "ctx.log in execution order with the replay
   * re-emit note").
   *
   * ## Why this is a permanent, honest empty state
   *
   * `ctx.log()` records (`WorkflowLogRecord`) are delivered ONLY to a
   * host-side `EngineOptions.onLog` sink registered at `Engine.create()`
   * time (weft v0.11.0 — see the `ctx.log` invariants in this repo's
   * `CLAUDE.md`: "A host `EngineOptions.onLog` sink receives records..."),
   * an in-process hook. There is no client-facing operation that retrieves
   * them — `getEvents()`, `getTimeline()`, and the full `WeftClient`
   * ergonomic surface (`src/client/interface.ts`, enumerated for this
   * track's report) have no `getLogs()`/log-list method, and `ctx.log`
   * records are not among `EVENTS_READ_EVENT_TYPES` either. A remote
   * console like this one genuinely cannot read them today. Rather than
   * build filter/search UI over data that will always be empty, this tab
   * names the gap plainly — see this track's final report for the upstream
   * issue.
   */
  import EmptyState from '@lostgradient/cinder/empty-state';
</script>

<EmptyState
  title="Logs aren't available yet"
  description={"ctx.log() records are only visible to a host-side EngineOptions.onLog sink today — there's no client operation that reads them back over HTTP. Filed upstream; this tab will populate once that ships."}
/>
