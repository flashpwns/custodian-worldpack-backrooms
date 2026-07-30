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
private knowledge from another mode.

## Known risk and meaningful choices

Pass 2 adds qualitative risk and an objective-linked choice contract. Risk is
derived exclusively from supplied, observer-known facts: whether a route is
mapped, whether a known retreat route exists, limited equipment, known team
condition, communication status, and admitted incident summaries. It is never
a hidden-danger lookup, probability, spawn modifier, or outcome controller.

Choices require at least two valid options with different persistent
consequence keys and disclose only rationale, known upside, known cost, and
known risk factors. The resolver records the selected branch and may resolve
the linked objective or offer a bounded follow-up; it does not reveal a hidden
future result. Revisit opportunities are likewise provenance-backed and use a
safe known-region reference rather than a hidden coordinate.

The mode loops now use the same contract in curated deterministic fixtures:

- Clear-Q4 weighs primary survey work, optional evidence, and a cautious
  record-and-return partial result.
- Nullzone weighs one carried recovery against another, with the unchosen
  object remaining physically present and archive value remaining personal.
- Lost weighs known landmark backtracking against an unmapped frontier while
  light is limited; stranded outcomes keep remnants in world history.
- Beck weighs recovery and research under finite, explicitly known priority
  pressure. Research and infrastructure stay institutional systems, not a new
  economy.

Retreat is deliberately a valid preservation decision. It can bank evidence,
objects, personnel, equipment, and partial success, while a deeper push can
create a follow-up, route knowledge, or recoverable loss. Failure therefore
creates persisted history and revisit reasons rather than deleting the run.

`yellow-beast-gameplay-projection@v1` now includes `known_risk`, `choices`,
and `revisit_opportunities`, alongside objectives, progression and summaries.
All are JSON-safe, deterministic, side-effect free, and independent of CLI
formatting. Remaining YB-26 work is presentation/application-shell work and
the Pass 3 scoped cross-mode timeline/callback surface.

`npm run gameplay-report` is a deterministic development harness, not user
analytics. It now flags risk-bearing and resource-constrained decisions,
retreat/push options, partial outcomes, revisit incentives, duplicate choices,
dead progression, and information leakage. Pass 3 will add the convergence
chain and scoped cross-mode callback coverage.
