# Canon model

Yellow Beast maintains four separate questions for every candidate proposition:

1. What does the source contain?
2. What does it claim or depict?
3. How reliable is that support?
4. Is the pack permitted to use it as simulation truth?

`canon/source-registry.json` describes sources without copying them.
`canon/claims/` stores analytical claims referencing source IDs. Claim evidence
type, canon status, project scope, confidence, and simulation authority are
independent values. A claim may be useful context while still being
`reference-only` or `prohibited` from changing world state.

The first pack-original claim confines the baseline survey layout to its scenario.
It does not assert a complete depiction of setting geography.
