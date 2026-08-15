"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const INVENTORY_FILE = "tools/verification-inventory.js";

function verifyInventoryCoreIntegrity(root = ROOT) {
  const authorityPath = path.join(root, "verification", "verification-authority.json");
  let authority;
  try {
    authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  } catch (error) {
    throw new Error(`runner core preflight could not read approved authority at ${authorityPath}: ${error.message}`);
  }
  const hashes = authority && authority.verification_core_hashes;
  const expectedHash = hashes && Object.prototype.hasOwnProperty.call(hashes, INVENTORY_FILE)
    ? hashes[INVENTORY_FILE]
    : null;
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`runner core preflight requires an approved SHA-256 for ${INVENTORY_FILE}`);
  }
  const inventoryPath = path.join(root, INVENTORY_FILE);
  let actualHash;
  try {
    actualHash = crypto.createHash("sha256").update(fs.readFileSync(inventoryPath)).digest("hex");
  } catch (error) {
    throw new Error(`runner core preflight could not read ${INVENTORY_FILE}: ${error.message}`);
  }
  if (actualHash !== expectedHash) {
    throw new Error(`runner core preflight hash mismatch: ${INVENTORY_FILE}`);
  }
  return { file: INVENTORY_FILE, expectedHash, actualHash };
}

verifyInventoryCoreIntegrity();
const inventory = require("./verification-inventory");
const TIERS = ["fast", "aggregate", "long-world", "native"];
const DEFAULT_SUBPROCESS_TIMEOUTS = Object.freeze({
  test: 10 * 60 * 1000,
  report: 10 * 60 * 1000,
  command: 30 * 60 * 1000,
});
const TIER_TIMEOUTS = Object.freeze({
  fast: Object.freeze({ test: 5 * 60 * 1000, report: 5 * 60 * 1000, command: 10 * 60 * 1000 }),
  aggregate: Object.freeze({ test: 15 * 60 * 1000, report: 10 * 60 * 1000, command: 15 * 60 * 1000 }),
  "long-world": Object.freeze({ test: 30 * 60 * 1000, report: 20 * 60 * 1000, command: 30 * 60 * 1000 }),
  native: Object.freeze({ test: 10 * 60 * 1000, report: 10 * 60 * 1000, command: 30 * 60 * 1000 }),
});

function loadManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest || !Array.isArray(manifest.test_files)) throw new Error("manifest must have a test_files array");
  return manifest;
}

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function resolveRoot(options) {
  if (options && options.root) return path.resolve(options.root);
  if (options && options.packagePath) return path.dirname(path.resolve(options.packagePath));
  if (options && options.manifestPath) return path.dirname(path.dirname(path.resolve(options.manifestPath)));
  return ROOT;
}

function resolveFile(root, file) {
  return path.isAbsolute(file) ? file : path.join(root, file.replace(/\\/g, "/"));
}

function npmInvocation(command) {
  if (process.platform === "win32") {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (!fs.existsSync(npmCli)) throw new Error(`unable to locate npm CLI for Windows at ${npmCli}`);
    return { executable: process.execPath, args: [npmCli, "run", command] };
  }
  return { executable: "npm", args: ["run", command] };
}

function timeoutFor(options, kind) {
  const configured = options && options.timeouts && options.timeouts[kind];
  const timeoutMs = configured === undefined ? DEFAULT_SUBPROCESS_TIMEOUTS[kind] : configured;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid ${kind} subprocess timeout ${JSON.stringify(timeoutMs)}`);
  }
  return timeoutMs;
}

function timedOut(result) {
  return Boolean(result && result.error && (result.error.code === "ETIMEDOUT" || result.error.killed));
}

function runCommand(command, options) {
  const root = resolveRoot(options);
  const spawnSyncImpl = (options && options.spawnSync) || childProcess.spawnSync;
  const timeoutMs = timeoutFor(options, "command");
  let invocation;
  try {
    invocation = npmInvocation(command);
  } catch (error) {
    return {
      command,
      passed: false,
      executed: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      timeoutMs,
      spawnError: error.message,
      output: "",
      errorOutput: "",
    };
  }
  const result = spawnSyncImpl(invocation.executable, invocation.args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
    cwd: root,
    env: childEnv(),
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  const executed = !result.error && typeof result.status === "number";
  return {
    command,
    passed: executed && result.status === 0 && !result.signal,
    executed,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: timedOut(result),
    timeoutMs,
    spawnError: result.error ? result.error.message : null,
    output: result.stdout || "",
    errorOutput: result.stderr || "",
  };
}

function planTier(manifest, tier) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier ${tier}; expected one of ${TIERS.join(", ")}`);
  const files = [];
  for (const entry of manifest.test_files) {
    if (entry.status !== "included") continue;
    if (tier === "fast") {
      if (entry.tier === "aggregate" && entry.fast === true) files.push(entry.file);
    } else if (entry.tier === tier) files.push(entry.file);
  }
  const reportTools = (manifest.report_tools || []).filter((tool) => {
    if (tool.status !== "required") return false;
    if (tier === "fast" || tier === "native") return false;
    return tool.tier === tier;
  });
  const requiredCommands = tier === "native" ? [...(manifest.native_required_commands || [])] : [];
  return { files, reportTools, requiredCommands };
}

function runTestFiles(files, options) {
  const root = resolveRoot(options);
  const timeoutMs = timeoutFor(options, "test");
  if (files.length === 0) {
    return { files, passed: true, executed: true, exitCode: 0, signal: null, timedOut: false, timeoutMs, spawnError: null, output: "", errorOutput: "" };
  }
  const spawnSyncImpl = (options && options.spawnSync) || childProcess.spawnSync;
  const result = spawnSyncImpl(process.execPath, ["--test", ...files.map((file) => resolveFile(root, file))], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
    cwd: root,
    env: childEnv(),
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  const executed = !result.error && typeof result.status === "number";
  return {
    files,
    passed: executed && result.status === 0 && !result.signal,
    executed,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: timedOut(result),
    timeoutMs,
    spawnError: result.error ? result.error.message : null,
    output: result.stdout || "",
    errorOutput: result.stderr || "",
  };
}

function runReportTool(tool, options) {
  const root = resolveRoot(options);
  const spawnSyncImpl = (options && options.spawnSync) || childProcess.spawnSync;
  const timeoutMs = timeoutFor(options, "report");
  let result;
  try {
    result = spawnSyncImpl(process.execPath, [resolveFile(root, tool.file)], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      cwd: root,
      env: childEnv(),
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
  } catch (error) {
    result = { status: null, signal: null, error, stdout: "", stderr: "" };
  }

  const executionCompletedNormally = !result.error && typeof result.status === "number" && !result.signal;
  let parsed = null;
  let parsedJson = false;
  let hasPassed = false;
  let declaredPassed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(result.stdout || "");
    parsedJson = true;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("top-level report JSON must be an object");
    hasPassed = Object.prototype.hasOwnProperty.call(parsed, "passed");
    if (!hasPassed) throw new Error("top-level report JSON must contain 'passed'");
    if (typeof parsed.passed !== "boolean") throw new Error(`top-level 'passed' must be boolean, got ${typeof parsed.passed}`);
    declaredPassed = parsed.passed;
  } catch (error) {
    parseError = error.message;
  }

  const exitCode = typeof result.status === "number" ? result.status : null;
  const exitPassed = executionCompletedNormally && exitCode === 0;
  const declarationExitConsistent = parseError === null && declaredPassed === exitPassed;
  const passed = executionCompletedNormally && parsedJson && parseError === null && hasPassed && declaredPassed === true && exitCode === 0;
  return {
    id: tool.id,
    script: tool.script,
    file: tool.file,
    passed,
    ok: passed,
    executionCompletedNormally,
    parsedJson,
    hasPassed,
    declaredPassed,
    declarationExitConsistent,
    parseError,
    exitCode,
    signal: result.signal || null,
    timedOut: timedOut(result),
    timeoutMs,
    spawnError: result.error ? result.error.message : null,
    output: result.stdout || "",
    errorOutput: result.stderr || "",
  };
}

function failedInventoryResult(tier, checks) {
  const testResult = {
    files: [], passed: false, executed: false, exitCode: 1, signal: null, timedOut: false,
    timeoutMs: null, spawnError: null, output: "", errorOutput: "",
  };
  return {
    tier,
    passed: false,
    inventoryPassed: false,
    inventoryChecks: checks,
    testsPassed: false,
    reportsPassed: false,
    commandsPassed: false,
    knownFailuresExpected: false,
    commandResults: [],
    testResult,
    reportResults: [],
    files: 0,
    known_failures: [],
  };
}

function executeTier(options) {
  const tier = options.tier;
  const root = resolveRoot(options);
  const manifestPath = options.manifestPath || path.join(root, "verification", "test-manifest.json");
  const authorityPath = options.authorityPath || path.join(root, "verification", "verification-authority.json");
  const packagePath = options.packagePath || path.join(root, "package.json");
  const manifest = loadManifest(manifestPath);
  const inventoryChecks = inventory.collectChecks({
    root,
    authorityPath,
    manifestPath,
    packagePath,
    testsDir: options.testsDir || path.join(root, "tests"),
    requiredProtectedTests: options.requiredProtectedTests,
    requiredVerificationCoreFiles: options.requiredVerificationCoreFiles,
  });
  if (!inventory.isConsistent(inventoryChecks)) return failedInventoryResult(tier, inventoryChecks);

  const plan = planTier(manifest, tier);
  const quarantineEntries = manifest.test_files
    .filter((entry) => entry.status === "quarantined" && entry.tier === tier)
    .map((entry) => ({ file: entry.file, reason: entry.reason, owner: entry.owner, defect_id: entry.defect_id, expiry: entry.expiry }));
  const executionOptions = {
    root,
    spawnSync: options.spawnSync,
    timeouts: { ...TIER_TIMEOUTS[tier], ...(options.timeouts || {}) },
  };
  const testResult = runTestFiles(plan.files, executionOptions);
  const reportResults = plan.reportTools.map((tool) => runReportTool(tool, executionOptions));
  const commandResults = plan.requiredCommands.map((command) => runCommand(command, executionOptions));
  const testsPassed = testResult.passed;
  const reportsPassed = reportResults.every((result) => result.passed);
  const commandsPassed = commandResults.every((result) => result.executed && result.passed && result.exitCode === 0 && !result.timedOut);
  const passed = testsPassed && reportsPassed && commandsPassed;
  return {
    tier,
    passed,
    inventoryPassed: true,
    inventoryChecks,
    testsPassed,
    reportsPassed,
    commandsPassed,
    knownFailuresExpected: quarantineEntries.length > 0,
    commandResults,
    testResult,
    reportResults,
    files: plan.files.length,
    known_failures: quarantineEntries,
  };
}

function printableSummary(summary) {
  return {
    tier: summary.tier,
    passed: summary.passed,
    inventoryPassed: summary.inventoryPassed,
    testsPassed: summary.testsPassed,
    reportsPassed: summary.reportsPassed,
    commandsPassed: summary.commandsPassed,
    testFiles: summary.files,
    testExitCode: summary.testResult.exitCode,
    testTimedOut: summary.testResult.timedOut,
    testTimeoutMs: summary.testResult.timeoutMs,
    testSignal: summary.testResult.signal,
    testSpawnError: summary.testResult.spawnError,
    knownFailuresExpected: summary.knownFailuresExpected,
    knownFailureCount: summary.known_failures.length,
    knownFailures: summary.known_failures,
    inventoryErrors: summary.inventoryChecks.filter((check) => check.severity === "error"),
    reportResults: summary.reportResults.map((result) => ({
      id: result.id,
      script: result.script,
      passed: result.passed,
      executionCompletedNormally: result.executionCompletedNormally,
      parsedJson: result.parsedJson,
      hasPassed: result.hasPassed,
      declaredPassed: result.declaredPassed,
      declarationExitConsistent: result.declarationExitConsistent,
      parseError: result.parseError,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      timeoutMs: result.timeoutMs,
      spawnError: result.spawnError,
    })),
    commandResults: summary.commandResults,
  };
}

function formatHumanOutput(summary) {
  const lines = [];
  for (const check of summary.inventoryChecks.filter((item) => item.severity === "error")) {
    lines.push(`[inventory-error] ${check.message}`);
  }
  for (const result of summary.reportResults) {
    lines.push(
      `[${result.passed ? "OK" : "FAIL"}] report ${result.id || result.script}: ` +
      `declaredPassed=${result.declaredPassed} exitCode=${result.exitCode} ` +
      `normal=${result.executionCompletedNormally} parsed=${result.parsedJson}` +
      `${result.timedOut ? ` TIMED_OUT(${result.timeoutMs}ms)` : ""}` +
      `${result.signal ? ` signal=${result.signal}` : ""}` +
      `${result.spawnError ? ` spawnError=${result.spawnError}` : ""}`
    );
  }
  for (const result of summary.commandResults) {
    lines.push(
      `[${result.passed ? "OK" : "FAIL"}] ${result.command}: executed=${result.executed} ` +
      `exitCode=${result.exitCode}${result.timedOut ? ` TIMED_OUT(${result.timeoutMs}ms)` : ""}` +
      `${result.signal ? ` signal=${result.signal}` : ""}${result.spawnError ? ` spawnError=${result.spawnError}` : ""}`
    );
  }
  if (!summary.testResult.passed && (summary.testResult.timedOut || summary.testResult.signal || summary.testResult.spawnError)) {
    lines.push(
      `[FAIL] tests: exitCode=${summary.testResult.exitCode}` +
      `${summary.testResult.timedOut ? ` TIMED_OUT(${summary.testResult.timeoutMs}ms)` : ""}` +
      `${summary.testResult.signal ? ` signal=${summary.testResult.signal}` : ""}` +
      `${summary.testResult.spawnError ? ` spawnError=${summary.testResult.spawnError}` : ""}`
    );
  }
  const known = summary.knownFailuresExpected
    ? ` knownFailuresExpected=true (${summary.known_failures.map((failure) => failure.file).join(", ")})`
    : " knownFailuresExpected=false";
  lines.push(
    `${summary.passed ? "PASSED" : "FAILED"} tier=${summary.tier} inventory=${summary.inventoryPassed} ` +
    `tests=${summary.testsPassed} reports=${summary.reportsPassed} commands=${summary.commandsPassed}${known}`
  );
  return lines.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--core-check")) {
    process.stdout.write("VERIFICATION CORE INTEGRITY OK\n");
    process.exit(0);
  }
  const tier = args.find((arg) => !arg.startsWith("--"));
  const asJson = args.includes("--json");
  if (!tier || !TIERS.includes(tier)) {
    process.stderr.write(`usage: node tools/verification-runner.js <${TIERS.join("|")}> [--json]\n`);
    process.exit(2);
  }
  let summary;
  try {
    summary = executeTier({ tier });
  } catch (error) {
    process.stderr.write(`verification-runner internal error: ${error.stack}\n`);
    process.exit(2);
  }

  if (asJson) {
    if (summary.testResult.output) process.stderr.write(summary.testResult.output);
    if (summary.testResult.errorOutput) process.stderr.write(summary.testResult.errorOutput);
    process.stdout.write(`${JSON.stringify(printableSummary(summary), null, 2)}\n`);
  } else {
    if (summary.testResult.output) process.stdout.write(summary.testResult.output);
    if (summary.testResult.errorOutput) process.stderr.write(summary.testResult.errorOutput);
    process.stdout.write(formatHumanOutput(summary));
  }
  process.exit(summary.passed ? 0 : 1);
}

module.exports = {
  ROOT,
  TIERS,
  DEFAULT_SUBPROCESS_TIMEOUTS,
  TIER_TIMEOUTS,
  executeTier,
  formatHumanOutput,
  loadManifest,
  npmInvocation,
  planTier,
  printableSummary,
  runCommand,
  runReportTool,
  runTestFiles,
  timeoutFor,
  verifyInventoryCoreIntegrity,
};

if (require.main === module) main();
