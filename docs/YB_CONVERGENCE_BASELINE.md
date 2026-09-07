# Yellow Beast Convergence Baseline

Established: 2026-09-07T03:16:00Z
Authoritative Branch: `main`
Authoritative Base Commit: `6a4e4eb4fee7c57746f02260ec2657da97c95645`
Product Version: `0.14.0-beta.1`
Authoritative Worktree: `/Users/jacktr/Developer/custodian-worldpack-backrooms`

## 1. Executive Summary

This document establishes the repository truth and starting baseline for the Gemini High System Convergence & 1.0 Realization Project.

The repository was consolidated from six preceding Yellow Beast development worktrees into a single unified `main` branch at commit `6a4e4eb`. Original working-tree snapshots and tips are preserved under Git tags `archive/consolidation-20260907T024323Z/{yellow,live,sol,claude,gemini,audit}`. The separate `flashpwns/custodian` engine repository remains untouched.

## 2. Inventory & Test Baseline

### Test Suite Execution
- **Fast Tier (`npm run test:fast`)**: 137 / 137 PASS
- **Meta Verification (`npm run test:meta`)**: 33 / 33 PASS (Inventory consistent, Core integrity OK)
- **Canonical Aggregate (`npm test`)**: 617 / 617 PASS, 3 required reports PASS
- **Long-World Tier (`npm run test:long-world`)**: 169 / 169 PASS, 1 required report PASS

### Test Inventory Classification (121 Total Test Files on Disk)
- **Included in Manifest**: 117 test files
- **Quarantined**: 4 test files
  1. `tests/y33-long-world-torture.test.js`: Quarantined in manifest under `defect_id: YB-V03-CANONICAL-EQUIVALENCE`. When run independently, passes 1/1 test.
  2. `tests/y34-beta-hotfix.test.js`: Stale pre-campaign UI expectations (`value="lost" disabled`). Quarantined under `defect_id: YB-V08-STALE-BETA-HOTFIX`.
  3. `tests/y35-product-focus.test.js`: Stale pre-campaign UI expectations. Quarantined under `defect_id: YB-V08-STALE-PRODUCT-FOCUS`.
  4. `tests/y54-settings-regression.test.js`: Native Electron display regression. Quarantined under `defect_id: YB-V23-NATIVE-SETTINGS-DISPLAY`.
- **Unexplained / Orphaned**: 0
- **Retired**: 0

## 3. Desktop Build & Packaging Truth

- **Host Platform**: macOS darwin / arm64 (Apple Silicon)
- **Desktop Build Tool**: `tools/build-desktop.js` calling tracked `@electron/asar` and `electron-builder`
- **Tracked Resolvers**: `tools/desktop-artifact-paths.js` resolves host platform executables (`mac-arm64/Yellow Beast.app/Contents/MacOS/Yellow Beast` and `app.asar`) dynamically without hardcoded Windows `.exe` paths or modified dependencies in `node_modules`.
- **Packaged Offline Smoke**: PASS
- **Packaged Renderer Interaction**: Documents a native `<select>` input simulation failure where macOS Chromium dropdown leaves AUTO selected rather than switching to offline mode; will be hardened during this campaign.

## 4. Runtime System Boundaries

- **Ontology & Reality**: Owned deterministically by Custodian simulation and canonical ledger (`tools/canonical-world-ledger.js`).
- **Observer Boundaries**: Maintained via observer-specific projections (`tools/observer-context-compiler.js`, `tools/perception-service.js`, `tools/live-scene-projection.js`).
- **Natural Language Parsing**: Controlled via `tools/ai-interpreter-boundary.js`, producing structured semantic proposals validated against affordances before canonical execution.
- **Onboarding / Pre-field Flow**: Governed by `tools/interpretive-director.js`, handling `BRIEFING`, `STAGING`, `FACILITY_TRANSIT`, `THRESHOLD`, and `STANDARD_RADIO_CHECK` with explicit authored beat priority and deterministic procedures.
