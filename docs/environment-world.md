# Canon-first Complex environment

Pass 3 treats environmental grammar as a composition problem, not a generic liminal-space theme. `tools/environment-world.js` is the developer-side registry linking each distinctive environment feature to a normalized claim. It currently admits bounded analogs for a column corridor, grid floor openings, a stair transition, a furnished room, ceiling tiles and fixtures, plus an interpretive recurring lit-panel cluster.

Those observations remain scoped. Grid openings only appear at a generated entry context; each source-local corridor, furnishing, stair, tile, and fixture analog is limited to one compatible local context in a region. The generator may combine those bounded features with explicitly generic procedural fill such as plain surfaces, ordinary wear, plain ceilings, local illumination, and mundane openings. Generic fill has no fake canon lineage and does not create a new environmental lore family.

The v2 generator stores physical layout and feature composition canonically. A seed determines the baseline; history records later mutations to objects, doors/edges, or node properties. Rebuilding and save/reload start from that baseline and replay mutations, so generation never resets moved objects, light state, or other physical history. Environment implementation family names and stable IDs remain developer-only.

Phenomena never maintain a second environment state. A supported event that changes a visible object or environmental property records a normal world-history mutation, preserving the separation between generated baseline and later history.

Clear-Q4 receives field-appropriate surveyed environmental detail; Beck receives only institutionally received summaries; Nullzone can retain observed environmental evidence; Lost receives descriptive local landmarks and repetition without formal family or topology labels. Scene fallback uses observer-visible environment facts only. It does not infer hidden rooms, causes, anomaly behavior, or atmosphere events from the grammar.

`npm run environment-world-report` reports vocabulary provenance, categories, procedural bounds, canon gravity, mode delivery, and persistence/safety invariants. Phenomenon behavior is separately bounded and reported by `npm run phenomena-report`.
