"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const AUTHORITY_FILE = "verification/verification-authority.json";
const VALID_STATUS = ["included", "quarantined", "retired"];
const VALID_TIERS = ["fast", "aggregate", "long-world", "native", "manual"];
const VALID_SCRIPT_DISPOSITIONS = [
  "canonical_aggregate",
  "tier_command",
  "required_report",
  "native_required",
  "supporting_non_authoritative",
  "non_verification",
];
const REQUIRED_NATIVE_COMMANDS = Object.freeze([
  "desktop:verify",
  "desktop:settings-regression",
  "desktop:first-run-regression",
]);
const REQUIRED_CANONICAL_AGGREGATE = Object.freeze({
  id: "yellow-beast-authoritative-aggregate",
  npm_script: "test",
  runner_file: "tools/verification-runner.js",
  tier: "aggregate",
});
const REQUIRED_CANONICAL_AGGREGATE_COMMAND =
  "node tools/verification-inventory.js && node tools/verification-runner.js aggregate";
const REQUIRED_REPORT_TOOLS = Object.freeze([
  Object.freeze({ id: "corpus-context-closure", script: "corpus-coverage-report", file: "tools/corpus-coverage-report.js", status: "required", tier: "aggregate" }),
  Object.freeze({ id: "stranger-flow", script: "stranger-flow-report", file: "tools/stranger-flow-report.js", status: "required", tier: "aggregate" }),
  Object.freeze({ id: "replayability", script: "y32-replayability-report", file: "tools/y32-replayability-report.js", status: "required", tier: "aggregate" }),
  Object.freeze({ id: "long-world-torture", script: "yb33-torture-report", file: "tools/yb33-torture-report.js", status: "required", tier: "long-world" }),
]);
const REQUIRED_NATIVE_SCRIPT_BINDINGS = Object.freeze({
  "desktop:build": "node tools/build-desktop.js",
  "desktop:verify": "node tools/verify-desktop-artifact.js",
  "desktop:settings-regression": "npm run desktop:build && node tools/verify-desktop-artifact.js",
  "desktop:first-run-regression": "npm run desktop:build && node tools/verify-first-run-artifact.js",
});
const REQUIRED_PROTECTED_TESTS = Object.freeze([
  "tests/y68-verification-gate.test.js",
  "tests/y68-long-world-known-failures.test.js",
]);
const REQUIRED_VERIFICATION_CORE_FILES = Object.freeze([
  "tools/verification-inventory.js",
  "tools/verification-runner.js",
  "tests/y68-verification-gate.test.js",
  "tests/y68-long-world-known-failures.test.js",
]);
const REQUIRED_EXECUTABLE_HASH_FILES = Object.freeze([
  ...REQUIRED_REPORT_TOOLS.map((tool) => tool.file),
  "tools/build-desktop.js",
  "tools/verify-desktop-artifact.js",
  "tools/verify-first-run-artifact.js",
]);

function optionsFromEnv() {
  const packagePath = process.env.YB_PACKAGE_PATH || path.join(ROOT, "package.json");
  const root = process.env.YB_ROOT || (process.env.YB_PACKAGE_PATH ? path.dirname(packagePath) : ROOT);
  return {
    root,
    authorityPath: process.env.YB_AUTHORITY_PATH || path.join(root, AUTHORITY_FILE),
    manifestPath: process.env.YB_MANIFEST_PATH || path.join(root, "verification", "test-manifest.json"),
    testsDir: process.env.YB_TESTS_DIR || path.join(root, "tests"),
    packagePath,
  };
}

function resolveOptions(overrides) {
  const defaults = optionsFromEnv();
  const supplied = overrides || {};
  const root = supplied.root || (supplied.packagePath ? path.dirname(supplied.packagePath) : defaults.root);
  return {
    root,
    authorityPath: supplied.authorityPath || (supplied.root ? path.join(root, AUTHORITY_FILE) : defaults.authorityPath),
    manifestPath: supplied.manifestPath || (supplied.root ? path.join(root, "verification", "test-manifest.json") : defaults.manifestPath),
    testsDir: supplied.testsDir || (supplied.root ? path.join(root, "tests") : defaults.testsDir),
    packagePath: supplied.packagePath || (supplied.root ? path.join(root, "package.json") : defaults.packagePath),
    requiredProtectedTests: supplied.requiredProtectedTests || REQUIRED_PROTECTED_TESTS,
    requiredVerificationCoreFiles: supplied.requiredVerificationCoreFiles || REQUIRED_VERIFICATION_CORE_FILES,
  };
}

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function normalizeRepoRelative(value) {
  if (typeof value !== "string" || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return null;
  const normalized = path.posix.normalize(toPosix(value));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}

function isMeaningful(value, minimumLength) {
  return typeof value === "string" && value.trim().length >= minimumLength;
}

function listTestFiles(testsDir, root) {
  if (!fs.existsSync(testsDir)) return [];
  const repoRoot = root || path.dirname(testsDir);
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".test.js")) {
        results.push(toPosix(path.relative(repoRoot, fullPath)));
      }
    }
  }
  walk(testsDir);
  return results.sort();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectTestFilesFromScript(pkg, scriptName, seen, out) {
  if (seen.has(scriptName)) return;
  const script = pkg.scripts && pkg.scripts[scriptName];
  if (typeof script !== "string") return;
  seen.add(scriptName);
  for (const command of script.split(/&&|;/)) {
    const cmd = command.trim();
    if (/^node --test(?:\s|$)/.test(cmd)) {
      for (const match of cmd.matchAll(/tests\/(?:[\w.\-]+\/)*[\w.\-]+\.test\.js/g)) out.add(match[0]);
    } else {
      const nested = cmd.match(/^npm run ([A-Za-z0-9:_\-]+)$/);
      if (nested) collectTestFilesFromScript(pkg, nested[1], seen, out);
    }
  }
}

function aggregateFileSetFromPackage(pkg) {
  const out = new Set();
  collectTestFilesFromScript(pkg, "test", new Set(), out);
  return out;
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function exactAuthorityEntry(actual, expected) {
  return actual && typeof actual === "object" &&
    Object.keys(expected).every((key) => actual[key] === expected[key]);
}

function flattenRequiredTests(authority, error) {
  const result = new Map();
  const groups = authority && authority.required_tests;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
    error("verification authority must define required_tests by tier");
    return result;
  }
  for (const [tier, files] of Object.entries(groups)) {
    if (!VALID_TIERS.includes(tier) || tier === "fast") error(`verification authority has invalid required-test tier ${JSON.stringify(tier)}`);
    if (!Array.isArray(files)) {
      error(`verification authority required_tests.${tier} must be an array`);
      continue;
    }
    for (const file of files) {
      const normalized = normalizeRepoRelative(file);
      if (!normalized || normalized !== file || !normalized.startsWith("tests/") || !normalized.endsWith(".test.js")) {
        error(`verification authority test identity must be exact repo-relative POSIX path: ${JSON.stringify(file)}`);
        continue;
      }
      if (result.has(file)) error(`duplicate governed required test identity: ${file}`);
      else result.set(file, tier);
    }
  }
  return result;
}

function registryById(records, idField, label, error) {
  const result = new Map();
  if (!Array.isArray(records)) {
    error(`verification authority must define ${label} as an array`);
    return result;
  }
  for (const record of records) {
    const id = record && record[idField];
    if (typeof id !== "string" || !id.trim()) {
      error(`${label} entry requires ${idField}`);
      continue;
    }
    if (result.has(id)) error(`duplicate ${label} id: ${id}`);
    else result.set(id, record);
  }
  return result;
}

function matchingDefect(entry, defectRegistry) {
  const record = defectRegistry.get(entry.defect_id);
  return record && record.file === entry.file && record.owner === entry.owner &&
    record.summary === entry.reason && record.review_condition === entry.expiry;
}

function matchingRetirement(entry, retirementRegistry) {
  const record = retirementRegistry.get(entry.retirement_id);
  if (!record || record.file !== entry.file || record.owner !== entry.owner || record.summary !== entry.reason) return false;
  const replacementMatches = typeof record.replacement === "string" && record.replacement === entry.replacement;
  const permanentMatches = record.permanent_retirement === true && entry.permanent_retirement === true;
  return replacementMatches || permanentMatches;
}

function matchingTierTransition(entry, fromTier, transitionRegistry) {
  const record = transitionRegistry.get(entry.tier_transition_id);
  return record && record.file === entry.file && record.from_tier === fromTier && record.to_tier === entry.tier &&
    typeof record.owner === "string" && record.owner.trim() && typeof record.review_condition === "string" && record.review_condition.trim();
}

function executableFromNodeScript(script) {
  if (typeof script !== "string") return null;
  const match = script.trim().match(/^node(?:\s+--[A-Za-z0-9=_-]+)*\s+([^\s]+\.js)$/);
  return match ? normalizeRepoRelative(match[1]) : null;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateExactHashMap(hashMap, fieldName, requiredFiles, root, error) {
  if (!hashMap || typeof hashMap !== "object" || Array.isArray(hashMap)) {
    error(`verification authority must define ${fieldName}`);
    return;
  }
  const entries = Object.entries(hashMap);
  if (entries.length === 0) error(`verification authority ${fieldName} must not be empty`);
  const requiredSet = new Set(requiredFiles);
  for (const file of requiredFiles) {
    if (!Object.prototype.hasOwnProperty.call(hashMap, file)) {
      error(`verification authority ${fieldName} missing required hash: ${file}`);
    }
  }
  for (const [file, expectedHash] of entries) {
    const normalized = normalizeRepoRelative(file);
    if (!normalized || normalized !== file || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      error(`invalid ${fieldName} authority for ${JSON.stringify(file)}`);
      continue;
    }
    if (!requiredSet.has(file)) {
      error(`verification authority ${fieldName} has extra unknown protected path: ${file}`);
      continue;
    }
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) error(`hashed protected file missing: ${file}`);
    else if (sha256(absolute) !== expectedHash) error(`protected file hash mismatch: ${file}`);
  }
}

function collectChecks(overrides) {
  const options = resolveOptions(overrides);
  const {
    root,
    authorityPath,
    manifestPath,
    testsDir,
    packagePath,
    requiredProtectedTests,
    requiredVerificationCoreFiles,
  } = options;
  const checks = [];
  const error = (message) => checks.push({ severity: "error", message });

  let authority;
  try {
    authority = loadJson(authorityPath);
  } catch (err) {
    error(`verification authority unreadable at ${authorityPath}: ${err.message}`);
    return checks;
  }
  if (!authority || authority.version !== "yellow-beast-verification-authority@v1") {
    error(`verification authority version must be 'yellow-beast-verification-authority@v1', got ${JSON.stringify(authority && authority.version)}`);
  }
  const requiredTests = flattenRequiredTests(authority, error);
  const defectRegistry = registryById(authority.known_defects, "defect_id", "known_defects", error);
  const retirementRegistry = registryById(authority.retirements, "retirement_id", "retirements", error);
  const transitionRegistry = registryById(authority.tier_transitions, "transition_id", "tier_transitions", error);
  for (const [id, record] of defectRegistry) {
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(id)) error(`known defect id must be structured: ${id}`);
    if (!requiredTests.has(record.file)) error(`known defect references ungoverned test: ${record.file}`);
    if (normalizeRepoRelative(record.file) !== record.file) error(`known defect file must be exact repo-relative identity: ${record.file}`);
    if (typeof record.owner !== "string" || !record.owner.trim() || typeof record.summary !== "string" || !record.summary.trim() ||
        typeof record.review_condition !== "string" || !record.review_condition.trim()) {
      error(`known defect ${id} requires owner, summary, and review_condition`);
    }
  }
  for (const [id, record] of retirementRegistry) {
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(id)) error(`retirement id must be structured: ${id}`);
    if (!requiredTests.has(record.file)) error(`retirement references ungoverned test: ${record.file}`);
    if (normalizeRepoRelative(record.file) !== record.file) error(`retirement file must be exact repo-relative identity: ${record.file}`);
    if (typeof record.owner !== "string" || !record.owner.trim() || typeof record.summary !== "string" || !record.summary.trim()) {
      error(`retirement ${id} requires owner and summary`);
    }
    const replacement = normalizeRepoRelative(record.replacement);
    const hasReplacement = typeof record.replacement === "string" && replacement === record.replacement;
    if (!hasReplacement && record.permanent_retirement !== true) {
      error(`retirement ${id} requires an exact replacement path or permanent_retirement=true`);
    }
  }
  for (const [id, record] of transitionRegistry) {
    if (!requiredTests.has(record.file)) error(`tier transition references ungoverned test: ${record.file}`);
    if (requiredTests.get(record.file) !== record.from_tier || !VALID_TIERS.includes(record.to_tier) || record.from_tier === record.to_tier) {
      error(`tier transition ${id} has invalid from/to authority`);
    }
    if (typeof record.owner !== "string" || !record.owner.trim() || typeof record.review_condition !== "string" || !record.review_condition.trim()) {
      error(`tier transition ${id} requires owner and review_condition`);
    }
  }
  validateExactHashMap(authority.executable_hashes, "executable_hashes", REQUIRED_EXECUTABLE_HASH_FILES, root, error);
  validateExactHashMap(authority.verification_core_hashes, "verification_core_hashes", requiredVerificationCoreFiles, root, error);

  let manifest;
  try {
    manifest = loadJson(manifestPath);
  } catch (err) {
    error(`manifest unreadable at ${manifestPath}: ${err.message}`);
    return checks;
  }
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.test_files)) {
    error("manifest must be an object with a test_files array");
    return checks;
  }
  if (typeof manifest.version !== "string" || !manifest.version.startsWith("yellow-beast-verification-manifest@")) {
    error(`manifest version must be 'yellow-beast-verification-manifest@...', got ${JSON.stringify(manifest.version)}`);
  }
  if (manifest.governance !== AUTHORITY_FILE) error(`manifest governance must identify ${AUTHORITY_FILE}`);

  const diskFiles = listTestFiles(testsDir, root);
  const diskSet = new Set(diskFiles);
  const entries = manifest.test_files;
  const byFile = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.file !== "string") {
      error("manifest entry missing a string 'file' field");
      continue;
    }
    const normalized = normalizeRepoRelative(entry.file);
    if (!normalized || !normalized.startsWith("tests/") || !normalized.endsWith(".test.js")) {
      error(`${entry.file}: test path must be an exact repository-relative tests/**/*.test.js path`);
      continue;
    }
    if (entry.file !== normalized) error(`${entry.file}: test path must use normalized POSIX repository-relative form ${normalized}`);
    if (byFile.has(normalized)) error(`duplicate manifest entry for ${normalized}`);
    byFile.set(normalized, entry);
  }

  for (const file of diskFiles) {
    if (!requiredTests.has(file)) error(`test file on disk has no independent required-test authority: ${file}`);
    if (!byFile.has(file)) error(`test file on disk has no manifest entry: ${file}`);
  }
  for (const [file] of requiredTests) {
    if (!byFile.has(file)) error(`governed required test has no manifest entry: ${file}`);
  }
  for (const [file, entry] of byFile) {
    const requiredTier = requiredTests.get(file);
    const authorizedTierTransition = requiredTier && entry.tier !== requiredTier && matchingTierTransition(entry, requiredTier, transitionRegistry);
    if (!requiredTier) error(`manifest test has no independent required-test authority: ${file}`);
    if (!VALID_STATUS.includes(entry.status)) error(`${file}: invalid status ${JSON.stringify(entry.status)}`);
    if (!VALID_TIERS.includes(entry.tier)) error(`${file}: invalid tier ${JSON.stringify(entry.tier)}`);
    if (entry.fast !== undefined && typeof entry.fast !== "boolean") error(`${file}: 'fast' must be a boolean`);
    if (entry.status === "included" && !["aggregate", "long-world", "native"].includes(entry.tier) && !authorizedTierTransition) {
      error(`${file}: status 'included' requires tier aggregate/long-world/native, got ${JSON.stringify(entry.tier)}`);
    }
    if (entry.status === "quarantined") {
      if (entry.tier === "aggregate") error(`${file}: quarantined file must not be tier 'aggregate'`);
      if (!matchingDefect(entry, defectRegistry)) error(`${file}: quarantine must exactly reference an independently declared known defect`);
    }
    if (entry.status === "retired") {
      if (!matchingRetirement(entry, retirementRegistry)) error(`${file}: retirement must exactly reference an independently declared retirement record`);
    }
    const validRetirement = entry.status === "retired" && matchingRetirement(entry, retirementRegistry);
    if (!diskSet.has(file) && !validRetirement) error(`manifest references missing test file: ${entry.file}`);
    if (requiredTier && entry.tier !== requiredTier && !authorizedTierTransition) {
      error(`${file}: required tier ${requiredTier} cannot change to ${entry.tier} without an independent tier-transition record`);
    }
  }

  const requiredTestHashFiles = [...requiredTests].filter(([file]) => {
    const entry = byFile.get(file);
    return !entry || entry.status !== "retired";
  }).map(([file]) => file);
  validateExactHashMap(authority.test_hashes, "test_hashes", requiredTestHashFiles, root, error);

  const requiredFast = Array.isArray(authority.required_fast_tests) ? authority.required_fast_tests : [];
  if (!Array.isArray(authority.required_fast_tests) || requiredFast.length === 0) {
    error("verification authority must define at least one required_fast_tests identity");
  }
  const requiredFastSet = new Set();
  for (const file of requiredFast) {
    if (normalizeRepoRelative(file) !== file || requiredTests.get(file) !== "aggregate") {
      error(`required fast test must be an exact governed aggregate identity: ${JSON.stringify(file)}`);
      continue;
    }
    if (requiredFastSet.has(file)) error(`duplicate required fast test identity: ${file}`);
    requiredFastSet.add(file);
  }
  const manifestFastSet = new Set(entries.filter((entry) => entry.fast === true).map((entry) => normalizeRepoRelative(entry.file)).filter(Boolean));
  for (const file of requiredFastSet) {
    const entry = byFile.get(file);
    if (!entry || entry.status !== "included" || entry.tier !== "aggregate" || entry.fast !== true) {
      error(`required fast test must remain included/aggregate/fast: ${file}`);
    }
  }
  for (const file of manifestFastSet) {
    if (!requiredFastSet.has(file)) error(`manifest fast test lacks independent fast authority: ${file}`);
  }

  if (!Array.isArray(manifest.protected_test_files)) error("manifest must define protected_test_files");
  const protectedFiles = new Set((manifest.protected_test_files || []).map(normalizeRepoRelative).filter(Boolean));
  for (const file of requiredProtectedTests) {
    if (!protectedFiles.has(file)) error(`protected verification-core test missing from authority metadata: ${file}`);
  }
  for (const file of protectedFiles) {
    const entry = byFile.get(file);
    if (!entry) error(`protected verification-core test has no manifest entry: ${file}`);
    else if (entry.status !== "included" || entry.tier !== "aggregate") {
      error(`protected verification-core test must remain included/tier aggregate: ${file}`);
    }
  }

  let pkg;
  try {
    pkg = loadJson(packagePath);
  } catch (err) {
    error(`package.json unreadable at ${packagePath}: ${err.message}`);
    return checks;
  }
  if (!pkg.scripts || typeof pkg.scripts !== "object") {
    error("package.json must define scripts");
    return checks;
  }

  const dispositionGroups = authority.verification_script_dispositions;
  const scriptDispositions = new Map();
  if (!dispositionGroups || typeof dispositionGroups !== "object" || Array.isArray(dispositionGroups)) {
    error("verification authority must define verification_script_dispositions");
  } else {
    for (const disposition of VALID_SCRIPT_DISPOSITIONS) {
      if (!Object.prototype.hasOwnProperty.call(dispositionGroups, disposition)) {
        error(`verification authority missing package-script disposition group: ${disposition}`);
      }
    }
    for (const [disposition, scripts] of Object.entries(dispositionGroups)) {
      if (!VALID_SCRIPT_DISPOSITIONS.includes(disposition)) error(`invalid verification script disposition: ${disposition}`);
      if (!Array.isArray(scripts)) {
        error(`verification script disposition ${disposition} must be an array`);
        continue;
      }
      for (const script of scripts) {
        if (typeof script !== "string" || !script.trim()) {
          error(`verification script disposition ${disposition} contains an invalid script identity`);
          continue;
        }
        if (scriptDispositions.has(script)) error(`duplicate verification script disposition for ${script}`);
        else scriptDispositions.set(script, disposition);
      }
    }
  }
  const packageScripts = new Set(Object.keys(pkg.scripts));
  for (const [script, body] of Object.entries(pkg.scripts)) {
    if (typeof body !== "string" || !body.trim()) error(`package script must have a non-empty string body: ${script}`);
    if (!scriptDispositions.has(script)) error(`package script has no explicit verification disposition: ${script}`);
  }
  for (const [script] of scriptDispositions) {
    if (!packageScripts.has(script)) error(`verification script disposition references missing package script: ${script}`);
  }
  const scriptsWithDisposition = (disposition) => [...scriptDispositions].filter(([, value]) => value === disposition).map(([script]) => script).sort();
  const requiredReportScripts = REQUIRED_REPORT_TOOLS.map((tool) => tool.script).sort();
  if (!exactArray(scriptsWithDisposition("required_report"), requiredReportScripts)) {
    error(`required_report disposition must exactly equal ${JSON.stringify(requiredReportScripts)}`);
  }
  if (!exactArray(scriptsWithDisposition("native_required"), [...REQUIRED_NATIVE_COMMANDS].sort())) {
    error(`native_required disposition must exactly equal ${JSON.stringify([...REQUIRED_NATIVE_COMMANDS].sort())}`);
  }
  if (!exactArray(scriptsWithDisposition("canonical_aggregate"), ["test"])) {
    error("canonical_aggregate disposition must contain only 'test'");
  }
  const requiredTierScripts = ["test:fast", "test:inventory", "test:long-world", "test:meta", "test:native"];
  if (!exactArray(scriptsWithDisposition("tier_command"), requiredTierScripts)) {
    error(`tier_command disposition must exactly equal ${JSON.stringify(requiredTierScripts)}`);
  }

  const aggregateAuthority = manifest.canonical_aggregate;
  if (!aggregateAuthority || typeof aggregateAuthority !== "object") {
    error("manifest must define canonical_aggregate authority metadata");
  } else {
    const npmScript = aggregateAuthority.npm_script;
    const runnerFile = normalizeRepoRelative(aggregateAuthority.runner_file);
    if (!isMeaningful(aggregateAuthority.id, 5)) error("canonical_aggregate requires a stable id");
    if (!isMeaningful(npmScript, 3) || typeof pkg.scripts[npmScript] !== "string") {
      error(`canonical aggregate npm script is missing: ${JSON.stringify(npmScript)}`);
    } else if (!runnerFile || aggregateAuthority.tier !== "aggregate" || pkg.scripts[npmScript].trim() !== REQUIRED_CANONICAL_AGGREGATE_COMMAND) {
      error(`${npmScript} must invoke the inventory-gated authoritative aggregate exactly: ${REQUIRED_CANONICAL_AGGREGATE_COMMAND}`);
    }
    if (!exactAuthorityEntry(aggregateAuthority, REQUIRED_CANONICAL_AGGREGATE)) {
      error(`canonical_aggregate must exactly identify ${JSON.stringify(REQUIRED_CANONICAL_AGGREGATE)}`);
    }
  }

  const reportTools = Array.isArray(manifest.report_tools) ? manifest.report_tools : [];
  const reportIds = new Set();
  const reportScripts = new Set();
  const reportFiles = new Set();
  if (reportTools.length !== REQUIRED_REPORT_TOOLS.length) {
    error(`report_tools must contain exactly ${REQUIRED_REPORT_TOOLS.length} required reports`);
  }
  for (const tool of reportTools) {
    if (!tool || typeof tool !== "object") {
      error("report_tools entries must be objects");
      continue;
    }
    if (!isMeaningful(tool.id, 5)) error(`report tool ${JSON.stringify(tool.script)} requires a stable id`);
    else if (reportIds.has(tool.id)) error(`duplicate report id: ${tool.id}`);
    else reportIds.add(tool.id);
    if (!isMeaningful(tool.script, 3)) error(`report tool ${JSON.stringify(tool.id)} requires an npm script name`);
    else if (reportScripts.has(tool.script)) error(`duplicate report npm script: ${tool.script}`);
    else reportScripts.add(tool.script);
    const toolFile = normalizeRepoRelative(tool.file);
    if (!toolFile) error(`report tool ${tool.id || tool.script}: file must be repository-relative`);
    else {
      if (reportFiles.has(toolFile)) error(`duplicate report executable path: ${toolFile}`);
      else reportFiles.add(toolFile);
      if (!fs.existsSync(path.join(root, toolFile))) error(`report tool file missing: ${toolFile}`);
      const actualExecutable = executableFromNodeScript(pkg.scripts[tool.script]);
      if (typeof pkg.scripts[tool.script] !== "string") error(`report tool ${toolFile}: no '${tool.script}' npm script defined`);
      else if (actualExecutable !== toolFile) {
        error(`report tool ${tool.id || tool.script}: npm script '${tool.script}' executes ${JSON.stringify(actualExecutable)} instead of ${toolFile}`);
      }
    }
    if (scriptDispositions.get(tool.script) !== "required_report") {
      error(`report tool ${tool.id || tool.script}: npm script must have required_report disposition`);
    }
    if (tool.status !== "required") error(`report tool ${tool.id || tool.script}: status must be 'required'`);
    if (!VALID_TIERS.includes(tool.tier) || !["aggregate", "long-world"].includes(tool.tier)) {
      error(`report tool ${tool.id || tool.script}: invalid automated tier ${JSON.stringify(tool.tier)}`);
    }
  }
  for (const requiredTool of REQUIRED_REPORT_TOOLS) {
    const declared = reportTools.find((tool) => tool && tool.id === requiredTool.id);
    if (!declared) error(`required report authority entry missing: ${requiredTool.id}`);
    else if (!exactAuthorityEntry(declared, requiredTool)) {
      error(`required report authority entry '${requiredTool.id}' must exactly equal ${JSON.stringify(requiredTool)}`);
    }
  }

  if (!exactArray(manifest.native_required_commands, REQUIRED_NATIVE_COMMANDS)) {
    error(`manifest native_required_commands must exactly equal ${JSON.stringify(REQUIRED_NATIVE_COMMANDS)}`);
  }
  const packageNative = pkg.verification && pkg.verification.nativeRequiredCommands;
  if (!exactArray(packageNative, REQUIRED_NATIVE_COMMANDS)) {
    error(`package.json verification.nativeRequiredCommands must exactly equal ${JSON.stringify(REQUIRED_NATIVE_COMMANDS)}`);
  }
  for (const command of REQUIRED_NATIVE_COMMANDS) {
    if (typeof pkg.scripts[command] !== "string" || !pkg.scripts[command].trim()) {
      error(`required native command '${command}' is not defined in package.json scripts`);
    }
  }
  for (const [script, expected] of Object.entries(REQUIRED_NATIVE_SCRIPT_BINDINGS)) {
    const actual = typeof pkg.scripts[script] === "string" ? pkg.scripts[script].trim() : null;
    if (actual !== expected) {
      error(`native script '${script}' must exactly invoke '${expected}', got ${JSON.stringify(actual)}`);
    }
  }

  return checks;
}

function isConsistent(checks) {
  return checks.every((check) => check.severity !== "error");
}

function summarize(checks, manifestPath) {
  return {
    manifest: path.basename(manifestPath || optionsFromEnv().manifestPath),
    errors: checks.filter((check) => check.severity === "error").length,
    warnings: checks.filter((check) => check.severity === "warn").length,
    consistent: isConsistent(checks),
  };
}

function deriveCounts(entries, diskFiles) {
  const manifestFiles = new Set(entries.map((entry) => normalizeRepoRelative(entry.file)).filter(Boolean));
  const diskSet = new Set(diskFiles);
  return {
    included: entries.filter((entry) => entry.status === "included").length,
    quarantined: entries.filter((entry) => entry.status === "quarantined").length,
    retired: entries.filter((entry) => entry.status === "retired").length,
    unexplainedOnDisk: diskFiles.filter((file) => !manifestFiles.has(file)).length,
    manifestRefMissingFromDisk: [...manifestFiles].filter((file) => !diskSet.has(file)).length,
  };
}

function main() {
  const asJson = process.argv.slice(2).includes("--json");
  const options = resolveOptions();
  let entries = [];
  let checks;
  try {
    const manifest = loadJson(options.manifestPath);
    entries = Array.isArray(manifest.test_files) ? manifest.test_files : [];
    checks = collectChecks(options);
  } catch (err) {
    process.stderr.write(`verification-inventory internal error: ${err.stack}\n`);
    process.exit(2);
  }
  const summary = summarize(checks, options.manifestPath);
  const diskFiles = listTestFiles(options.testsDir, options.root);
  const counts = deriveCounts(entries, diskFiles);
  if (asJson) process.stdout.write(`${JSON.stringify({ summary, counts, checks }, null, 2)}\n`);
  else {
    for (const check of checks) process.stdout.write(`[${check.severity}] ${check.message}\n`);
    process.stdout.write(
      `${summary.consistent ? "INVENTORY CONSISTENT" : "INVENTORY INCONSISTENT"} ` +
      `(${summary.errors} errors, ${summary.warnings} warnings, manifest ${summary.manifest}) ` +
      `included=${counts.included} quarantined=${counts.quarantined} retired=${counts.retired} ` +
      `unexplainedOnDisk=${counts.unexplainedOnDisk} manifestRefMissingFromDisk=${counts.manifestRefMissingFromDisk}\n`
    );
  }
  process.exit(summary.consistent ? 0 : 1);
}

module.exports = {
  ROOT,
  REQUIRED_CANONICAL_AGGREGATE,
  REQUIRED_CANONICAL_AGGREGATE_COMMAND,
  REQUIRED_NATIVE_COMMANDS,
  REQUIRED_NATIVE_SCRIPT_BINDINGS,
  REQUIRED_EXECUTABLE_HASH_FILES,
  REQUIRED_PROTECTED_TESTS,
  REQUIRED_REPORT_TOOLS,
  REQUIRED_VERIFICATION_CORE_FILES,
  aggregateFileSetFromPackage,
  collectChecks,
  deriveCounts,
  executableFromNodeScript,
  isConsistent,
  listTestFiles,
  normalizeRepoRelative,
  resolveOptions,
  summarize,
};

if (require.main === module) main();
