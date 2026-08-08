# Yellow Beast / Custodian Agent Instructions

Before modifying this repository, interpreting simulation state, designing player-facing behavior, or generating implementation that may affect player-facing output, read the following in order:

1. `SIMULATION_DOCTRINE.md`
2. the Yellow Beast 1.0 Design Charter
3. `docs/IMPLEMENTATION_STATE.md`, if present
4. the current pass specification
5. any domain-specific doctrine explicitly referenced by the current pass, including UI or audio doctrine

## Constitutional Authority

`SIMULATION_DOCTRINE.md` is the highest project authority governing:

- ontology and canonical reality,
- causality,
- persistence,
- observer boundaries,
- knowledge propagation,
- institutional cognition,
- personnel interpretation,
- canonical entity identity versus observer-facing designation,
- generated-text interpretation,
- FAILRP prevention,
- presentation of uncertain or incomplete information,
- worldpack interpretation.

Lower-order documents may refine, implement, or narrow these rules.

They may not silently contradict them.

The current implementation pass controls **scope**.

The Simulation Doctrine controls **reality**.

If a current pass appears to conflict with the Simulation Doctrine:

1. determine whether the pass explicitly declares an amendment or superseding rule;
2. if it does not, preserve the Doctrine;
3. record the conflict in `docs/IMPLEMENTATION_STATE.md`;
4. do not invent a compromise that weakens canonical truth, persistence, or observer integrity.

## Runtime Interpretation Principle

Player-facing AI systems must never be treated as simulation authorities.

The required conceptual boundary is:

`CANONICAL STATE`
→ `OBSERVER-SAFE PROJECTION`
→ `SIMULATION DOCTRINE`
→ `WORLDPACK TERMINOLOGY / PRESENTATION RULES`
→ `BOUNDED GENERATION TASK`
→ `CANDIDATE OUTPUT`
→ `VALIDATION / FALLBACK`
→ `PLAYER-FACING OUTPUT`

AI-generated prose may present canonical state.

It may not create canonical state.

Do not give an AI provider unrestricted world state merely because that is convenient for prompting.

## Engineering Discipline

Preserve existing canonical authorities.

Fix defects at the lowest correct authority.

Do not patch renderer symptoms when simulation truth is wrong.

Do not mutate simulation truth to repair presentation-only defects.

Do not create parallel authorities for state already owned by Custodian.

Do not broaden the current pass merely because later requirements are visible.

When uncertain, prefer, in order:

1. canonical truth,
2. persistence,
3. observer integrity,
4. institutional causality,
5. deterministic simulation authority,
6. player comprehension,
7. presentation fidelity,
8. spectacle.

If an implementation would make the experience more dramatic but less truthful, do not implement it.
