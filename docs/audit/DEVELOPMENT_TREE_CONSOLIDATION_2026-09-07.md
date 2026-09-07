# Development tree consolidation — 2026-09-07

Purpose: establish one GitHub main and a clean springboard from the six Yellow Beast development worktrees. This is repository reconciliation, not release certification.

## Preservation and decisions

Exact working-tree snapshots, including previously untracked source, are retained under Git tags `archive/consolidation-20260907T024323Z/{yellow,live,sol,claude,gemini,audit}`. Original local and GitHub branch tips are also archived under that prefix. The separate `flashpwns/custodian` engine repository is outside this worldpack consolidation.

The Yellow Beast checkout supplies the current command transaction, credential, provider-failure, and native build safeguards. Its later fixes supersede the earlier live-turn worktree versions. Older Sol and Claude variants are preserved in history; conflicts retain the reconciled cockpit, observer boundaries, and provider implementation. Claude's additional 20 ledger invariant tests are retained and registered. Preserving branch ancestry does not mean mutually exclusive implementations were both enabled.

Gemini's deterministic observer services, authored presentation, lexicon, onboarding, acceptance repairs, alpha authority-file packaging, and layout correction are integrated. Its broad target guessing is superseded by the existing ambiguity and custody safeguards. Its edited node_modules build bridge is excluded; a fresh npm ci uses the tracked platform-aware build and artifact resolvers.

Integration repairs reject negated, conditional, questioned, or compound readiness without state mutation; preserve fallback provenance when authored text is present; and save completed presentation history after canonical consequences have already committed. A failure of this later presentation save is logged and reported separately without claiming the accepted action was lost.

## Verification

Fresh dependency installation completed. Aggregate: 617 tests passed, zero failed, plus three required reports. Long-world: 169 tests passed plus its required report. Inventory: 117 included, four quarantined, zero errors or warnings. Explicit asset whitelist and whitespace checks passed. Desktop packaging and native smoke evidence are recorded in the consolidation task; macOS packaging remains unsigned, and this pass makes no Windows runtime or release-certification claim.

The intended final repository state is GitHub main as the only active remote branch, with all six local development worktrees at that exact commit. Archive tags preserve historical and superseded work for recovery. Start new work from main; do not restore an old snapshot over the consolidated baseline.
