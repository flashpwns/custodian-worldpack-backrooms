# Yellow Beast Verification Governance

## 1. Overview & Canonical Gate

Yellow Beast enforces strict, cryptographic verification governance. Every test file, reporting tool, and executable script is governed by dual authority documents:
- `verification/verification-authority.json` (the cryptographic ground truth and policy registry)
- `verification/test-manifest.json` (the execution manifest)

The canonical repository-wide verification gate is invoked via:
```bash
npm test
```
Which is bound in `package.json` to:
```bash
node tools/verification-inventory.js && node tools/verification-runner.js aggregate
```

No test execution proceeds if the verification inventory check fails.

---

## 2. Test Tiers & Execution Hierarchy

| Tier | Command | Purpose & Composition |
|---|---|---|
| **fast** | `npm run test:fast` | Core regression tests designed to complete in under 5 seconds. Contains foundational data models, topology, and core contracts. |
| **aggregate** | `npm test` | **Authoritative repository gate**. Contains all active product tests (79 test files) plus the 3 required reports (`corpus-coverage-report`, `stranger-flow-report`, `y32-replayability-report`). |
| **long-world** | `npm run test:long-world` | Extended endurance, torture, career-loop, and multi-turn simulation suites (e.g. YB-33). |
| **native** | `npm run test:native` | Electron packaging, display regression, and desktop prerequisite verification. |
| **manual** | N/A | Human-only exploratory scripts or deprecated pre-campaign acceptance targets. |

---

## 3. Test Lifecycle & Status Rules

Every test file in `tests/**/*.test.js` must exist in `verification/test-manifest.json` with one of three valid statuses:

### `included`
- Active test suite required to execute and pass.
- Must belong to `aggregate`, `long-world`, or `native` tier.
- Cannot be in `manual` tier unless authorized by a tier transition record.

### `quarantined`
- Preserved failing evidence for a known product defect.
- **Must never belong to tier `aggregate`** (must be moved to `long-world`, `native`, or `manual`).
- Must reference an explicit, structured `defect_id` in `verification/verification-authority.json` under `known_defects`.
- Requires documented `owner`, `summary`, and `review_condition`.

### `retired`
- Explicitly decommissioned test file.
- Must reference an explicit `retirement_id` in `verification/verification-authority.json` under `retirements`.
- Requires either an exact repo-relative `replacement` path or `permanent_retirement: true`.
- A retired file may be removed from disk once authorized.

---

## 4. Cryptographic Hash Protection

The verification authority maintains three separate SHA-256 hash dictionaries:

1. **`test_hashes`**:
   - Contains the exact SHA-256 hash of every active non-retired test file on disk.
   - Prevents unauthorized or silent modifications to test assertions.

2. **`executable_hashes`**:
   - Covers mandatory reporting and desktop build scripts:
     - `tools/corpus-coverage-report.js`
     - `tools/stranger-flow-report.js`
     - `tools/y32-replayability-report.js`
     - `tools/yb33-torture-report.js`
     - `tools/build-desktop.js`
     - `tools/verify-desktop-artifact.js`
     - `tools/verify-first-run-artifact.js`

3. **`verification_core_hashes`**:
   - Protects the verification harness itself:
     - `tools/verification-inventory.js`
     - `tools/verification-runner.js`
     - `tests/y68-verification-gate.test.js`
     - `tests/y68-long-world-known-failures.test.js`
   - Verified by preflight checks before any runner imports or executes inventory logic.

---

## 5. Line-Ending Hygiene (LF vs CRLF)

> [!IMPORTANT]
> All repository files must use POSIX line endings (**LF**).
> SHA-256 hashes are computed on the raw byte content of files on disk (`crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")`). If files are converted to CRLF (e.g., via Windows git checkout settings), hash checks will fail immediately.

Ensure git configuration enforces LF checkout:
```bash
git config core.autocrlf false
git config core.eol lf
```

---

## 6. Troubleshooting Inventory Drift

### Symptom: `unexplainedOnDisk`
- **Cause**: A new `.test.js` file was created in `tests/` but not registered.
- **Remedy**:
  1. Add the file to `required_tests.<tier>` in `verification/verification-authority.json`.
  2. Add an entry to `test_files` in `verification/test-manifest.json` with status `"included"`.
  3. Recompute and update the file's hash in `test_hashes`.

### Symptom: `protected file hash mismatch`
- **Cause**: A test file or executable tool was edited, or its line endings changed from LF to CRLF.
- **Remedy**:
  1. If intentional, recompute the SHA-256 hash of the modified file.
  2. Update the corresponding hash entry in `verification/verification-authority.json`.
  3. Run `node tools/verification-inventory.js` to confirm consistency.

### Symptom: `manifestRefMissingFromDisk`
- **Cause**: A test file listed in `test-manifest.json` was deleted without being formally retired.
- **Remedy**:
  - If accidental: restore the missing file.
  - If intentional: register a retirement entry in `verification/verification-authority.json` (`retirements`) before removing the manifest reference.
