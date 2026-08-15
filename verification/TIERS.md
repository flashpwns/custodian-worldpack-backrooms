# Yellow Beast Verification Tiers

**Authority:** V02 - Test Truth and Verification Gate (`docs/YELLOW_BEAST_VISION_PASS_MAP.md`, V02).
**Governance:** `verification/verification-authority.json` is the approved, mutable verification-governance
source. It fixes every governed test's exact repository-relative identity, content hash, and required tier;
declares known defects, retirements, authorized tier transitions, verifier-core and required-executable hashes;
and explicitly disposes every package script. `verification/test-manifest.json` is the mutable execution
manifest and must reconcile exactly with that authority.
**Inventory gate:** `npm run test:inventory` and every verification-runner tier fail when the filesystem,
manifest, `package.json`, report executable bindings, protected core, or native command authorities disagree.

## External trust boundary

The authority file is source code, not a cryptographic root of trust. Verification governance changes require
explicit review against an externally approved Git baseline. Ordinary implementation work must not modify the
authority, its governed hashes, or the verifier core unless that governance change is specifically authorized.

The in-repository verifier detects regression, omission, reclassification, and content drift relative to the
approved governance baseline. It does not claim resistance to a malicious committer who can rewrite the
verifier, its tests, and its authority together. Approval and anchoring of that baseline are external review
responsibilities; the repository does not manufacture a circular self-authentication claim.

Verification types are deliberately not collapsed into "tests passing." A green aggregate means the CI gate is
green. It does not mean the long-world, native, or manual evidence is green.

## Tier definitions

| Tier | Meaning | Owning command | Must be green |
|---|---|---|---|
| `fast` | Quick unit/contract tests for pre-commit feedback. A subset of the aggregate set. | `npm run test:fast` | Yes |
| `aggregate` | The metadata-driven CI gate consumed by `npm test`. | `npm test` | Yes |
| `long-world` | Heavy/long-running tests and the known-defect torture evidence. | `npm run test:long-world` | No until its known defect is repaired (V03) |
| `native` | Packaged Electron and real-display verification. | `npm run test:native` | Yes (with display) |
| `manual` | Human validation gates recorded in implementation state. | Human, per pass exit gates | n/a |

## Manifest contract

Each `test_files` entry declares:

- `file`: exact normalized POSIX path relative to the repository root.
- `status`: `included`, `quarantined`, or `retired`.
- `tier`: the primary tier. `fast: true` additionally marks an aggregate file as fast.
- Quarantine metadata: meaningful `reason`, `owner`, structured `defect_id`, and `expiry`/review condition.
- Retirement metadata: meaningful `reason`, `owner`, and either a repository-relative `replacement` or a
  `permanent_justification`.

Paths in `protected_test_files` must remain `included` in the aggregate tier. Status-only removal is invalid.
This is an additional verification-core guard, not the complete required-test authority: every test identity
and required tier is independently fixed by `required_tests`. Coordinated disk/manifest deletion therefore
fails. Tier movement requires an exact `tier_transition_id` record with file, from/to tiers, owner, and review
condition.

Every governed non-retired test must have exactly one SHA-256 entry in `test_hashes`, and its current bytes must
match. `verification_core_hashes` is an exact four-file set covering the inventory, runner, verification gate,
and known-failure gate. A pass-only replacement of any governed test or verifier-core file is content drift and
fails inventory until a specifically authorized governance update records the new hash.

Quarantine metadata is valid only when its `defect_id`, file, owner, reason, and expiry exactly match a record
in `known_defects`. Retirement metadata is valid only when its `retirement_id`, file, owner, and reason exactly
match a record in `retirements`, which must also declare an exact replacement or
`permanent_retirement: true`. Prose length is not used as authority.

Each required `report_tools` entry declares a stable ID, exact npm script, exact executable file, tier, and
required status. The npm script must invoke that exact file. A report passes only after normal execution, valid
JSON parsing, an own top-level boolean `passed` field equal to `true`, and exit code zero. Declaration/exit
agreement is diagnostic consistency only; a `passed:false` report never passes.

`native_required_commands` is independently fixed to `desktop:verify`, `desktop:settings-regression`, and
`desktop:first-run-regression`. Both manifest and `package.json` must match it exactly, and the native tier must
actually execute all three successfully.

Every package script, including non-verification commands, must have exactly one explicit entry in
`verification_script_dispositions`. There is no name-pattern inference. New `pretest`, `posttest`, certification,
smoke, validation, report, or similarly confidence-bearing commands therefore fail inventory until explicitly
classified. Only `required_report` entries run as authoritative report tools; supporting commands are explicitly
labeled non-authoritative.

`executable_hashes` is an exact, non-empty set covering all four required reports plus the desktop build,
artifact verification, and first-run verification executables. Missing or extra entries and byte mismatches
fail inventory. Required report IDs, npm scripts, and executable paths are each unique.

All spawned test, report, and native commands have positive tier-specific timeouts. Timeouts, signals, spawn
failures, and forced termination are failures and are reported explicitly; long-world and native limits are
intentionally conservative.

## Honest failure policy

- Genuine product defects remain failing or explicitly quarantined evidence; they are never rewritten to make
  the suite green.
- A report that prints `"passed": false` fails the tier even when it exits nonzero consistently.
- Expected unresolved defect evidence is labeled separately from PASS and keeps its executing tier nonzero.
