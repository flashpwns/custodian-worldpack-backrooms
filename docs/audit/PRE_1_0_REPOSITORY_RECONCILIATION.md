# Yellow Beast pre-1.0 repository reconciliation

Audit date: 2026-09-04. Canonical candidate: `integration/pre-1.0-reconciliation`, initially cut from `890300ff4eb04de44b32e6463941a51a4fe6cef2`.

## Repository truth

Yellow Beast lives in the Git repository whose common Git directory is `/Users/jacktr/Developer/custodian-worldpack-backrooms/.git` and whose remote is `https://github.com/flashpwns/custodian-worldpack-backrooms.git`. The separate `flashpwns/custodian` checkout is a dependency/kernel repository, not the Yellow Beast product checkout.

| Worktree | Branch | Audited HEAD | State at freeze | Disposition |
|---|---|---|---|---|
| `/Users/jacktr/Developer/custodian-worldpack-backrooms` | `reference-expedition/foundation` | `173edc060f5e5a3d530f4bdb1683f1fd67b0299a` | Dirty: 7 staged paths; 3 also unstaged | Preserved, non-canonical evidence source |
| `/Users/jacktr/Developer/custodian-worldpack-backrooms-gemini` | `gemini/aeot-presentation` | `890300ff4eb04de44b32e6463941a51a4fe6cef2` | Clean at freeze | Source baseline for integration |
| `/Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit` | `integration/pre-1.0-reconciliation` | `890300ff4eb04de44b32e6463941a51a4fe6cef2` before audit artifacts | Clean, independently installed dependencies | Authoritative audit/build location |

Only the first two worktrees existed at freeze. The third was created after preservation and classification. No merge, rebase, or cherry-pick state and no stashes existed. The only remote branch observed was `origin/reference-expedition/foundation`; no fetch or push was performed.

Backup refs created without changing either source worktree:

- `backup/pre-audit-sol-head-20260904` -> `173edc0`
- `backup/pre-audit-gemini-head-20260904` -> `890300f`
- `backup/pre-audit-sol-dirty-20260904` -> `8a44efa` (index plus working-tree snapshot made with `git stash create`; the dirty worktree was not altered)

## Commit reconciliation

The branch merge base is `37be7a1d21c6fa35a493e27544a5b2a465f8b75f`.

| Work | Classification | Evidence / disposition |
|---|---|---|
| Sol `63c33f4` vs Gemini `e7bcc4f` | DUPLICATE | Exact patch ID `6a553da...`; facility operation events already present in Gemini |
| Sol `173edc0` vs Gemini `d7da20d` | DUPLICATE | Exact patch ID `4ea599...`; Threshold authority migration already present |
| Sol `e1b483d` | INTEGRATED SEMANTICALLY | Final Gemini verifier files contain the same ASAR leading-separator normalization |
| Sol `c867c16` | INTEGRATED SEMANTICALLY | Reference report/evidence/institution separation exists in Gemini and is covered by y69/y78 |
| Sol `f6631b3` | PARTIAL / DEFERRED | Build provenance and newer Custodian adapter are useful; its provider rewrite would remove Gemini's tested provider pool and failover path, so it must not be cherry-picked wholesale |
| Sol dirty UI/audio pass | SUPERSEDED / EXPERIMENTAL | Substantial overlap with Gemini y75-y77 presentation work; contains competing phase-driven versus canonical-event audio approaches. Preserved at `8a44efa` for selective review only |
| Gemini `37be7a1..890300f` | ADMITTED AS BASELINE, NOT RELEASE-CERTIFIED | Contains AEOT UI, report triad, hosted provider pool, living-turn pipeline, and living-world substrate. Behavioral evidence exists, but verification authority and native packaging gates are red |

## Source and path audit

- No tracked symlinks or executable source imports escaping the repository were found.
- Absolute user paths occur in historical documentation, not runtime source.
- Gemini's ignored `node_modules` was a symlink to the Sol worktree. It resolved Custodian 1.6.0 from a different checkout while the Gemini lockfile named `b3738da`. This made the original Gemini test/package evidence mixed-checkout evidence.
- The integration worktree ran `npm ci` and installed the lock's `b3738da` dependency independently. The dependency's own package reports version 1.6.0 while `package-lock.json` records 1.5.0; the commit identity is the stronger authority, but the lock metadata should be regenerated in the approved dependency pass.
- `desktop/build-info.json` is ignored and generated. Leaving it in the Gemini working directory caused y77 startup hygiene to fail; the clean integration checkout did not have that failure before packaging.

## Reconciliation decision

Continue only on `integration/pre-1.0-reconciliation`. Do not merge the source branches into it wholesale. Admit future changes by semantic review against the authority map, with a focused fix and test for each closure-ledger item. The source worktrees and backup refs remain forensic evidence until 1.0 closure.

