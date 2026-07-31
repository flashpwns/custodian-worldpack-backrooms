# Intent → consequence architecture

YB-27 replaces predefined-action classification at the language boundary with `yellow-beast-intent@v1`. A player may describe an attempted behavior without selecting, or being mapped to, a canonical action ID.

`raw_input` is preserved exactly, alongside a non-canonical proposal containing goals, decomposable steps, methods, references, conditions, preferences, social and communication intent, temporal ordering, uncertainty, assumptions, and optional clarification. Steps retain sequence or parallel relationships so later resolution may stop safely after an interruption.

References can remain `unresolved`; the interpreter must not invent a referent. Negative constraints (for example, “without entering”) and stated priorities are retained rather than treated as outcomes. Attempt wording retains uncertainty: interpreting an attempt does not make it succeed.

Providers normalize into this same strict contract. The deterministic mock is used by tests; the OpenAI adapter is only an adapter and has no provider-specific representation in the schema. Invalid provider output returns a structured `interpretation_error` with raw input preserved and no world mutation. Clarifications are also non-canonical: `clarification_required`, a question, and only safe candidate labels.

The interpreter receives only the observer-safe context generated from the public run status: profile, scenario, lifecycle, observed location, visible labels, known resources, and public reason. It receives no session, hidden topology, hidden entities or hazards, omniscient history, or other observers’ private knowledge. It narrates nothing and invents no horror details.

The current structured controls remain canonical play infrastructure. Their compatibility direction is one-way: a legacy structured command can be represented as an intent proposal, but a freeform intent is never forced back into an action menu. The experimental desktop language field now reports only that a proposal was captured; it performs no action and persists no world change.

Pass 2 will ground observer-safe references such as “the chair”, “him”, “that door”, and “the noise”. Later passes will separately perform capability/constraint checks and consequence resolution under Custodian’s canonical authority.

## Pass 2: observer-safe grounding

`yellow-beast-grounded-intent@v1` preserves the original intent and adds deterministic grounding results. Each result records the original reference, a machine-usable canonical ref only after it was selected from a safe candidate, its player-safe label, source (`visible`, `inventory`, `memory`, `discourse`, `role`, `phenomenon`, or `self`), category, and match type. Candidate indexes are derived from the observer projection and never from raw simulation state.

Ambiguous references return stable, minimal clarification with safe labels only. Unresolved references remain unresolved, including conceptual unknowns such as “whatever made that sound”; a perceived phenomenon can ground without inventing its source. Partial grounding is allowed. Recent grounded referents form a bounded, eight-item discourse cache, rather than a second truth store. Remembered candidates remain memory-sourced and are not upgraded to objective certainty.

Each mode supplies its own safe candidates: Clear-Q4 can expose observed equipment and known team labels; Beck exposes only reviewed institutional knowledge; Nullzone exposes civilian labels and archive memory; Lost exposes only immediate surroundings and legitimately remembered landmarks. Grounding cannot create a candidate from another mode’s knowledge. It does not mutate world state, time, inventory, knowledge, or events, and does not decide ability, permission, reachability, or success.

Pass 3 will consume grounded references for capability and constraint resolution. It must not be inferred from Pass 2 output that an attempt can happen or succeeds.

## Pass 5: observer-safe scene presentation

`yellow-beast-scene@v1` is a non-canonical, provider-neutral presentation contract built only from the observer-safe run projection and Pass 4's observer-safe consequence result. It has a stable identity derived from the session, turn, safe location, and fact ledger; it never stores or reads hidden session state as prose material. Required facts (location and material consequence) are distinguished from optional environmental, visible, inventory, and contextual facts. Significance (`MICRO` through `CRITICAL`) controls the fallback's density: orientation and new-area scenes include safe environment facts, while delta scenes report changes without repeating the room.

The deterministic fallback is the offline baseline. It uses human-facing labels, preserves uncertainty supplied by safe facts, and never adds player emotions, motives, hidden causes, actor thoughts, dialogue, entities, exits, or opaque IDs. Provider narration is optional and may receive only the scene, mode profile, and bounded safe context. Its structured response must reference known safe fact IDs; unsupported content or provider failure falls back without rerunning or changing the canonical consequence.

One shared contract supports Clear-Q4's field context, Beck's institutional framing, Nullzone's personal/archive framing, and Lost's immediate limited-knowledge framing. These profiles alter emphasis, never objective reality or cross-mode knowledge. Scene generation is presentation only: canonical state, timing, actor behavior, and communications remain Custodian and Yellow Beast simulation responsibilities.

## Pass 6: loop closure

`executePlayerTurn` is the application boundary for a freeform turn: interpretation, validation, grounding, planning, canonical consequence, safe scene construction, and fallback narration execute in that order. The desktop consumes only its stable player-turn result and persists only after an accepted canonical consequence. The renderer never reconstructs pipeline stages.

The freeform loop is offline-first. The deterministic interpreter and scene fallback support bounded input (4,000 characters; intent steps remain capped at 16), idempotent request IDs, reload-safe consequences, and a 50-turn fixture. Structured controls are intentionally retained as an accessibility/debug fallback, not the primary field interaction. Current limits are deliberate: generic physics and social resolution remain coarse, provider prose is optional, and mode-specific tutorials and deep UI reconstruction belong to YB-28.

## Pass 3: capability planning

`yellow-beast-resolution-plan@v1` adds deterministic, non-canonical step analysis: generalized capabilities, constraints, dependencies, permission, possibility, unknowns, and interruption points. It composes mundane primitives such as locomotion, posture change, grasping, object movement, climbing, observation, listening, communication, recording, waiting, and throwing. These are not player commands.

Possible, permitted, and successful are separate states. A prohibited attempt can still be physically possible; an unknown property remains unknown; a plan never implies success. Plans preserve player constraints, conditional structure, preferences, parallel/ordered steps, and expose only safe explanations. Pass 4 alone may execute canonical attempts and consequences.
