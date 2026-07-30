# Expedition system

`async-clear-q4-field-survey` is a bounded, deterministic Clear-Q4 expedition. It is a Yellow Beast scenario layer: Custodian still owns world state, action resolution, observer authority, export/restore, and replay.

An expedition has a declared team, an institutional order, required and optional objective lifecycles, a logical clock, declared equipment, messages, observer-safe evidence, deviations, and a structured terminal result. An order is instruction, not objective truth.

The field verbs are `COMMUNICATE`, `RECORD`, and `WAIT`, alongside `LOOK`, `MOVE`, `INSPECT`, and declared `USE` interactions. Communication tracks intended recipient and delivery separately. Evidence records only the current observer-safe target, with creator, custody, location, and order position. `WAIT` advances one deterministic interval; a missed declared check-in can degrade the mission. `RETURN` and `ABORT` create a terminal expedition result.

The result contains objective state, team status, evidence, equipment state, messages, deviations, clock, outcome, and unresolved findings. It is designed as a future input to Async: Beck's Desk, but does not implement that mode or cross-run persistence yet.

AI providers receive only the existing observer-safe status and aliases. They may propose the new verbs, but Yellow Beast validates each action and Custodian resolves all canonical world actions.
