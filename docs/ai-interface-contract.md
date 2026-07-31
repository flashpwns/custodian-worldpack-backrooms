# AI interface contract

Custodian remains simulation authority; Yellow Beast owns setting semantics. The YB-13 AI adapter only interprets natural language, requests clarification, and presents observer-safe results.

```
Player language → strict freeform intent validation → later grounding
  → later capability / consequence resolution → public Custodian API
```

The interpreter proposes attempted behavior, not actions or outcomes. The context packet contains title, scenario, lifecycle, observed location, visible labels, known resources, and public reasons. It never contains raw sessions/projections, opaque Custodian refs, hidden targets, hidden topology, or another observer's state.

Unresolved references remain unresolved for Pass 2 grounding. Invalid model output, guessed targets, prompt-injection text, failures, and unavailable providers execute nothing. Intent output is noncanonical and is never required for replay or restore.

Grounding is deterministic and receives only an explicit observer-safe candidate index. It may retain a bounded safe discourse cache. It returns safe labels for clarification, never opaque internal identifiers, and never turns a perceived sound or conceptual unknown into an unseen source entity.
