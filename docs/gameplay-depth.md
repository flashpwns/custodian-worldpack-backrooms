# Gameplay depth

YB-25 treats gameplay as a consequence of the shared persistent world, rather
than as a parallel quest database. Objectives are event-backed, have a stable
identity, explicit origin/provenance, known information, a primary/secondary/
deviation classification, bounded follow-up depth, outcome, and optional
progression reward.

Progression is operational rather than XP: a completed Clear-Q4 survey can
unlock preparation; a reviewed institutional observation can create a Beck
follow-up; a Nullzone artifact gains personal archive relevance; and a Lost
result records a sparse outcome without promising a safe path. Unlocks do not
assert canon or alter objective reality.

Evidence and artifact valuation is domain-relative. The first known item of a
kind is useful/significant; later comparable material is routine/duplicate.
This supports decision-making without converting evidence value into source
authority or arcade score.

Session summaries and `yellow-beast-gameplay-projection@v1` are safe structured
inputs for a future UI: offered/resolved objectives, progression, valuation,
follow-ups, and scoped timeline entries. They exclude hidden world facts and
private knowledge from another mode. The next passes add risk/reward and full
cross-mode convergence.

`npm run gameplay-report` is a deterministic development harness, not user
analytics. It flags objective counts, follow-ups, progression, duplicate or
unreachable objective conditions, and information leakage. Future YB-25 work
will broaden it to resource tradeoffs, retreat choices, callbacks, and
cross-mode chains.
