# Developer console

Enable the inspector only for a local developer launch:

`YELLOW_BEAST_DEVELOPER_MODE=1 npm run desktop:dev`

The ordinary player shell neither shows nor can enable this entry. When enabled,
World Entry exposes **Developer console**, a deliberately non-fictional,
read-only surface. Closing it returns to the ordinary world-entry view; it does
not change mode, phase, inventory, reports, evidence, or world history.

The console consumes `DesktopService.getDeveloperSnapshot`, which derives a
Pass-1 snapshot from the normal world. It separates **Objective world**,
**Observer view**, and **Provider-safe context** rather than merging them. The
bounded panels cover continuity, objects/evidence, region seed/history,
phenomena, institution data available in objective state, derived threads, and
the 20 most recent canonical events. Internal identifiers are intentionally
developer-only.

Observer selection changes only console display. Threads are visibly marked
derived/noncanonical. The intent form is a Clear-Q4 **non-executing** trace:
it runs safe context, interpretation, grounding, and planning, but never calls
consequence resolution. Provider diagnostics include only selection/status and
the already safe context; credentials are never returned or logged.

`npm run dev-console-report` records the console contract and invariants. Pass
3 may add safe explicit developer operations and report controls; this pass
adds no mutation command, state editor, or debug save format.
