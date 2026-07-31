# Intent → consequence architecture

YB-27 replaces predefined-action classification at the language boundary with `yellow-beast-intent@v1`. A player may describe an attempted behavior without selecting, or being mapped to, a canonical action ID.

`raw_input` is preserved exactly, alongside a non-canonical proposal containing goals, decomposable steps, methods, references, conditions, preferences, social and communication intent, temporal ordering, uncertainty, assumptions, and optional clarification. Steps retain sequence or parallel relationships so later resolution may stop safely after an interruption.

References can remain `unresolved`; the interpreter must not invent a referent. Negative constraints (for example, “without entering”) and stated priorities are retained rather than treated as outcomes. Attempt wording retains uncertainty: interpreting an attempt does not make it succeed.

Providers normalize into this same strict contract. The deterministic mock is used by tests; the OpenAI adapter is only an adapter and has no provider-specific representation in the schema. Invalid provider output returns a structured `interpretation_error` with raw input preserved and no world mutation. Clarifications are also non-canonical: `clarification_required`, a question, and only safe candidate labels.

The interpreter receives only the observer-safe context generated from the public run status: profile, scenario, lifecycle, observed location, visible labels, known resources, and public reason. It receives no session, hidden topology, hidden entities or hazards, omniscient history, or other observers’ private knowledge. It narrates nothing and invents no horror details.

The current structured controls remain canonical play infrastructure. Their compatibility direction is one-way: a legacy structured command can be represented as an intent proposal, but a freeform intent is never forced back into an action menu. The experimental desktop language field now reports only that a proposal was captured; it performs no action and persists no world change.

Pass 2 will ground observer-safe references such as “the chair”, “him”, “that door”, and “the noise”. Later passes will separately perform capability/constraint checks and consequence resolution under Custodian’s canonical authority.
