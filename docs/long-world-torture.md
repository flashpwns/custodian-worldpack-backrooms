# YB-33 long-world torture

`npm run yb33-torture-report` runs the deterministic beta-stability workload.
It starts from the existing 150-turn convergence fixture, adds 2,500
history-backed reports and periodic environment mutations, then repeats
story-thread, consequence-echo, unfinished-business, observer, and developer
inspection reads. It saves and reloads the resulting world eight times.

The same workload also drives 48 offline desktop turns across all four modes,
alternating natural-language input and mode entry, changing presentation
preferences, inspecting through the read-only developer boundary, and
simulating six application restarts. It checks provider failure recovery,
recap/search presentation, stale response rejection, object/death/phenomenon
continuity, and new-world storage isolation through fresh temporary roots.

The report records workload size and persistence/convergence evidence. Timing
is diagnostic only; no machine-specific duration threshold makes the test
flaky. Existing YB-31 measurements remain the performance reference: the
5,000-event cold story-thread derivation is approximately 10.9 ms median on
the reference workspace.
