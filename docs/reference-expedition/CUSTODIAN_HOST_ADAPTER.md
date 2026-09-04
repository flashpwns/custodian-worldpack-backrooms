# Custodian host adapter reconciliation

## Contract

Yellow Beast consumes Custodian through the package root. The reconciled call is:

```js
runAIGameTurn({
  session: entry.run,
  observer: entry.run.session.startup.player.observer_id,
  player_input: text,
  generate,
  trace,
  host_adapter: createCustodianAIHostAdapter()
})
```

The adapter version is `custodian-ai-gameplay-host-adapter@v1`. Its sole method,
`runTurn`, receives `{ session, observer, player_input, generate, trace }` and
returns `{ ok: true, session, turn, diagnostics }`. `turn` is
`custodian-ai-gameplay-host-turn@v1`.

Custodian rejects any adapter result whose returned `session` is not the same
object by identity as the supplied session. Yellow Beast passes its existing
`entry.run`; neither repository creates a second session for the turn.

## Authority ownership

- Custodian owns the package entry point, host-adapter version, result-envelope
  validation, and session-identity rejection.
- Yellow Beast owns canonical world/run persistence, spatial and object state,
  mission and return/report state, equipment and evidence custody, coworker
  decisions, observer-safe live-scene projection, and generated-presentation
  validation.
- The model remains a bounded interpreter and presenter. It owns no canonical
  state and cannot replace the host session.

## Publication boundary

The desktop dependency remains pinned to the published/reachable Custodian Git
commit recorded in `package.json` and `package-lock.json`. Do not change that pin
to an unpushed commit and do not vendor or link source as permanent architecture.
After the host-adapter commit is available from the Custodian remote, update the
desktop dependency pin and route `DesktopService.submitNatural` through the
package-root call above. Persist only the returned identical `entry.run` through
the existing coordinated persistence pair.
