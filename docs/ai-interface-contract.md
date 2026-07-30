# AI interface contract

Custodian remains simulation authority; Yellow Beast owns setting semantics. The YB-13 AI adapter only interprets natural language, requests clarification, and presents observer-safe results.

```
Player language → strict intent validation → Yellow Beast action
  → public Custodian API → safe result envelope → narration adapter → player
```

Only currently available `LOOK`, `MOVE`, `INSPECT`, and `USE` may be proposed. The context packet contains title, scenario, lifecycle, safe location, available verbs, visible aliases, safe resources, and public reasons. It never contains raw sessions/projections, opaque Custodian refs, hidden targets, or another observer's state.

Aliases originate in the public Custodian observer view and are revalidated after every compound step. Invalid model output, guessed targets, prompt-injection text, failures, and unavailable providers execute nothing. Narration changes wording only; it receives no canonical state and cannot override the structured result. AI output is noncanonical and is never required for replay or restore.
