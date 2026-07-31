# YB-31 Pass 5: Runtime performance

Pass 5 profiles the existing runtime seams using the deterministic 150-turn,
four-mode convergence fixture (`yb31-performance`) and a 5,000-event long
history. `npm run performance-report` runs five wall-clock samples per
workload and reports medians, minima, maxima, serialized result size, and a
small retained-world heap probe. Timing is diagnostic only; no test depends on
a machine-specific threshold.

The measured hotspot was repeated story-thread derivation during the 150-turn
fixture and developer/observer projection. The pre-optimization baseline was
2.03 ms median for the fixture; the optimized path measures 0.44 ms median on
the same workspace (about 78% lower). Each call previously sorted and
regrouped canonical events. The optimized path keeps a derived index in a
WeakMap per live world and reuses profile-specific allowed-event sets. The
cache is not serialized, is reconstructible from canonical history, and is
invalidated when the canonical event revision changes (sequence, length, or
last event identity). Lost remains an empty thread view, and observer filtering
still happens after derivation.

Save/load was measured as already small at the representative fixture size and
was left unchanged. Rendering remains bounded by the existing public scene
facts and narration fallback; no presentation data is written into world
history.

The report records semantic-safety evidence: canonical state remains the
authority, identical seed/actions retain the same history, derived caches are
world-scoped and disposable, and all four observer modes are exercised. Run
`npm run performance-report` for the current before/after-ready measurements;
the committed report format intentionally avoids flaky timing assertions.
