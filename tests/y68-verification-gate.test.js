"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const inventory = require("../tools/verification-inventory");
const runner = require("../tools/verification-runner");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "verification", "test-manifest.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const INVENTORY_TOOL = path.join(ROOT, "tools", "verification-inventory.js");
const PROTECTED = ["tests/core.test.js"];
const CORE_FILES = ["tools/verification-runner.js", "tests/core.test.js"];
const PASS_TEST = 'const test=require("node:test");test("pass",()=>{});\n';
const FAIL_TEST = 'const test=require("node:test"),assert=require("node:assert/strict");test("fail",()=>assert.fail("fixture failure"));\n';
const PASS_REPORT = 'process.stdout.write(JSON.stringify({passed:true}));\n';
const PASS_NATIVE = "process.exit(0);\n";
const FIXTURE_RUNNER = "// fixture path identity only\n";
const HANG_REPORT = "setInterval(() => {}, 1000);\n";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function baseManifest() {
  return {
    version: "yellow-beast-verification-manifest@v2",
    canonical_aggregate: { ...inventory.REQUIRED_CANONICAL_AGGREGATE },
    protected_test_files: [...PROTECTED],
    native_required_commands: [...inventory.REQUIRED_NATIVE_COMMANDS],
    test_files: [
      { file: "tests/core.test.js", status: "included", tier: "aggregate", fast: true },
      { file: "tests/a.test.js", status: "included", tier: "aggregate" },
      {
        file: "tests/fail.test.js",
        status: "quarantined",
        tier: "manual",
        reason: "Fixture failure retained for quarantine enforcement coverage.",
        owner: "verification fixture",
        defect_id: "YB-FIXTURE-FAILURE",
        expiry: "Review after the fixture contract changes",
      },
    ],
    report_tools: inventory.REQUIRED_REPORT_TOOLS.map((tool) => ({ ...tool })),
  };
}

function baseAuthority(manifest = baseManifest()) {
  const requiredTests = { aggregate: [], "long-world": [], native: [], manual: [] };
  for (const entry of manifest.test_files) requiredTests[entry.tier].push(entry.file);
  return {
    version: "yellow-beast-verification-authority@v1",
    required_tests: requiredTests,
    required_fast_tests: manifest.test_files.filter((entry) => entry.fast === true).map((entry) => entry.file),
    test_hashes: {
      "tests/core.test.js": hash(PASS_TEST),
      "tests/a.test.js": hash(PASS_TEST),
      "tests/fail.test.js": hash(FAIL_TEST),
    },
    verification_core_hashes: {
      "tools/verification-runner.js": hash(FIXTURE_RUNNER),
      "tests/core.test.js": hash(PASS_TEST),
    },
    known_defects: manifest.test_files.filter((entry) => entry.status === "quarantined").map((entry) => ({
      defect_id: entry.defect_id,
      file: entry.file,
      owner: entry.owner,
      summary: entry.reason,
      review_condition: entry.expiry,
    })),
    retirements: [],
    tier_transitions: [],
    executable_hashes: {
      "tools/corpus-coverage-report.js": hash(PASS_REPORT),
      "tools/stranger-flow-report.js": hash(PASS_REPORT),
      "tools/y32-replayability-report.js": hash(PASS_REPORT),
      "tools/yb33-torture-report.js": hash(PASS_REPORT),
      "tools/build-desktop.js": hash(PASS_NATIVE),
      "tools/verify-desktop-artifact.js": hash(PASS_NATIVE),
      "tools/verify-first-run-artifact.js": hash(PASS_NATIVE),
    },
    verification_script_dispositions: {
      canonical_aggregate: ["test"],
      tier_command: ["test:meta", "test:inventory", "test:fast", "test:long-world", "test:native"],
      required_report: inventory.REQUIRED_REPORT_TOOLS.map((tool) => tool.script),
      native_required: [...inventory.REQUIRED_NATIVE_COMMANDS],
      supporting_non_authoritative: ["desktop:build"],
      non_verification: [],
    },
  };
}

function basePackage() {
  return {
    name: "verification-fixture",
    version: "1.0.0",
    verification: { nativeRequiredCommands: [...inventory.REQUIRED_NATIVE_COMMANDS] },
    scripts: {
      test: inventory.REQUIRED_CANONICAL_AGGREGATE_COMMAND,
      "corpus-coverage-report": "node tools/corpus-coverage-report.js",
      "stranger-flow-report": "node tools/stranger-flow-report.js",
      "y32-replayability-report": "node tools/y32-replayability-report.js",
      "yb33-torture-report": "node tools/yb33-torture-report.js",
      "test:meta": "node --test tests/core.test.js",
      "test:inventory": "node tools/verification-inventory.js",
      "test:fast": "node tools/verification-runner.js fast",
      "test:long-world": "node tools/verification-runner.js long-world",
      "test:native": "node tools/verification-runner.js native",
      ...inventory.REQUIRED_NATIVE_SCRIPT_BINDINGS,
    },
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-verification-meta-"));
  write(root, "tests/core.test.js", PASS_TEST);
  write(root, "tests/a.test.js", PASS_TEST);
  write(root, "tests/fail.test.js", FAIL_TEST);
  for (const tool of inventory.REQUIRED_REPORT_TOOLS) {
    write(root, tool.file, PASS_REPORT);
  }
  write(root, "tools/native-pass.js", "process.exit(0);\n");
  write(root, "tools/build-desktop.js", PASS_NATIVE);
  write(root, "tools/verify-desktop-artifact.js", PASS_NATIVE);
  write(root, "tools/verify-first-run-artifact.js", PASS_NATIVE);
  write(root, "tools/verification-runner.js", FIXTURE_RUNNER);
  const manifest = baseManifest();
  manifest.governance = "verification/verification-authority.json";
  write(root, "verification/test-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  write(root, "verification/verification-authority.json", `${JSON.stringify(baseAuthority(manifest), null, 2)}\n`);
  write(root, "package.json", `${JSON.stringify(basePackage(), null, 2)}\n`);
  return {
    root,
    testsDir: path.join(root, "tests"),
    authorityPath: path.join(root, "verification", "verification-authority.json"),
    manifestPath: path.join(root, "verification", "test-manifest.json"),
    packagePath: path.join(root, "package.json"),
  };
}

function fixtureOptions(fixture) {
  return { ...fixture, requiredProtectedTests: PROTECTED, requiredVerificationCoreFiles: CORE_FILES };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function errorsFor(fixture) {
  return inventory.collectChecks(fixtureOptions(fixture)).filter((check) => check.severity === "error");
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function createEntrypointFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-verification-entrypoint-"));
  for (const item of ["package.json", "tests", "tools", "verification"]) {
    fs.cpSync(path.join(ROOT, item), path.join(root, item), { recursive: true });
  }
  return { root };
}

function runNode(root, args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function runNpmScript(root, script) {
  const invocation = runner.npmInvocation(script);
  return spawnSync(invocation.executable, invocation.args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function authoritativeInventorySuccess(result) {
  return result.status === 0 && !result.signal && /INVENTORY CONSISTENT/.test(result.stdout || "");
}

test("real repository inventory and CLI are consistent", () => {
  assert.deepEqual(inventory.collectChecks().filter((check) => check.severity === "error"), []);
  const cli = spawnSync(process.execPath, [INVENTORY_TOOL], { cwd: ROOT, encoding: "utf8" });
  assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
});

test("every governed non-retired test has exact content identity", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tests/a.test.js", 'const test=require("node:test");test("pass-only replacement",()=>{});\n');
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.includes("protected file hash mismatch: tests/a.test.js"), errors.join("\n"));
    assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("verification core files have exact content identity", () => {
  for (const file of CORE_FILES) {
    const fixture = createFixture();
    try {
      write(fixture.root, file, "// pass-only verification-core replacement\nprocess.exitCode = 0;\n");
      const errors = errorsFor(fixture).map((check) => check.message);
      assert.ok(errors.includes(`protected file hash mismatch: ${file}`), errors.join("\n"));
    } finally {
      cleanup(fixture);
    }
  }
});

test("canonical entry points reject a replaced runner before it can exit zero", () => {
  const fixture = createEntrypointFixture();
  try {
    write(fixture.root, "tools/verification-runner.js", "process.exit(0);\n");

    const directInventory = runNode(fixture.root, ["tools/verification-inventory.js"]);
    assert.notEqual(directInventory.status, 0, `${directInventory.stdout}\n${directInventory.stderr}`);

    for (const script of ["test", "test:meta", "test:inventory"]) {
      const result = runNpmScript(fixture.root, script);
      assert.notEqual(result.status, 0, `${script} falsely passed\n${result.stdout}\n${result.stderr}`);
    }
  } finally {
    cleanup(fixture);
  }
});

test("canonical entry points reject a replaced inventory before importing it", () => {
  const fixture = createEntrypointFixture();
  try {
    write(fixture.root, "tools/verification-inventory.js", "process.exit(0);\n");

    const rawInventory = runNode(fixture.root, ["tools/verification-inventory.js"]);
    assert.equal(rawInventory.status, 0);
    assert.equal(authoritativeInventorySuccess(rawInventory), false, "a bare zero exit without the inventory success contract is not authoritative");

    const directAggregate = runNode(fixture.root, ["tools/verification-runner.js", "aggregate"]);
    assert.notEqual(directAggregate.status, 0, `${directAggregate.stdout}\n${directAggregate.stderr}`);
    assert.match(directAggregate.stderr, /runner core preflight hash mismatch: tools\/verification-inventory\.js/);

    for (const script of ["test", "test:meta", "test:inventory"]) {
      const result = runNpmScript(fixture.root, script);
      assert.notEqual(result.status, 0, `${script} falsely passed\n${result.stdout}\n${result.stderr}`);
    }
  } finally {
    cleanup(fixture);
  }
});

test("runner pre-import inventory guard fails closed on missing authority, missing file, and hash drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-runner-preflight-"));
  try {
    write(root, "verification/verification-authority.json", JSON.stringify({ verification_core_hashes: {} }));
    assert.throws(
      () => runner.verifyInventoryCoreIntegrity(root),
      /requires an approved SHA-256 for tools\/verification-inventory\.js/
    );

    write(root, "verification/verification-authority.json", JSON.stringify({
      verification_core_hashes: { "tools/verification-inventory.js": hash("approved inventory") },
    }));
    assert.throws(
      () => runner.verifyInventoryCoreIntegrity(root),
      /could not read tools\/verification-inventory\.js/
    );

    write(root, "tools/verification-inventory.js", "different inventory");
    assert.throws(
      () => runner.verifyInventoryCoreIntegrity(root),
      /hash mismatch: tools\/verification-inventory\.js/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("executable hash authority is mandatory, exact, and non-vacuous", () => {
  const cases = [
    ["missing map", (authority) => { delete authority.executable_hashes; }, "verification authority must define executable_hashes"],
    ["empty map", (authority) => { authority.executable_hashes = {}; }, "verification authority executable_hashes must not be empty"],
    ["missing required hash", (authority) => { delete authority.executable_hashes["tools/corpus-coverage-report.js"]; }, "verification authority executable_hashes missing required hash: tools/corpus-coverage-report.js"],
    ["extra hash", (authority) => { authority.executable_hashes["tools/unknown-verifier.js"] = hash(PASS_REPORT); }, "verification authority executable_hashes has extra unknown protected path: tools/unknown-verifier.js"],
  ];
  for (const [name, mutate, expected] of cases) {
    const fixture = createFixture();
    try {
      const authority = readJson(fixture.authorityPath);
      mutate(authority);
      writeJson(fixture.authorityPath, authority);
      const errors = errorsFor(fixture).map((check) => check.message);
      assert.ok(errors.includes(expected), `${name}: ${errors.join("\n")}`);
    } finally {
      cleanup(fixture);
    }
  }
});

test("report PASS requires normal execution, valid top-level boolean true, and exit zero", () => {
  const fixture = createFixture();
  try {
    const cases = [
      ["false / 1", 'process.stdout.write(JSON.stringify({passed:false}));process.exit(1);\n'],
      ["false / 0", 'process.stdout.write(JSON.stringify({passed:false}));\n'],
      ["true / 1", 'process.stdout.write(JSON.stringify({passed:true}));process.exit(1);\n'],
      ['"false" / 0', 'process.stdout.write(JSON.stringify({passed:"false"}));\n'],
      ['"true" / 0', 'process.stdout.write(JSON.stringify({passed:"true"}));\n'],
      ["missing", 'process.stdout.write(JSON.stringify({report:"missing"}));\n'],
      ["null", 'process.stdout.write(JSON.stringify({passed:null}));\n'],
      ["malformed JSON", 'process.stdout.write("{not-json");\n'],
      ["empty output", ""],
      ["crash", 'throw new Error("fixture crash");\n'],
    ];
    for (const [name, source] of cases) {
      const relative = `tools/report-${crypto.createHash("sha1").update(name).digest("hex")}.js`;
      write(fixture.root, relative, source);
      const result = runner.runReportTool({ id: name, script: name, file: relative }, { root: fixture.root });
      assert.equal(result.passed, false, `${name} must fail: ${JSON.stringify(result)}`);
    }

    const spawnError = runner.runReportTool(
      { id: "spawn-error", script: "spawn-error", file: "tools/good-report.js" },
      {
        root: fixture.root,
        spawnSync: () => ({ status: null, signal: null, error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), stdout: "", stderr: "" }),
      }
    );
    assert.equal(spawnError.passed, false);
    assert.equal(spawnError.executionCompletedNormally, false);

    const success = runner.runReportTool(
      { id: "valid", script: "corpus-coverage-report", file: "tools/corpus-coverage-report.js" },
      { root: fixture.root }
    );
    assert.equal(success.passed, true);
    assert.equal(success.declarationExitConsistent, true);
  } finally {
    cleanup(fixture);
  }
});

test("metadata/report npm-script target drift is rejected by inventory and runner", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tools/failing-report.js", 'process.stdout.write(JSON.stringify({passed:false}));process.exit(1);\n');
    const pkg = readJson(fixture.packagePath);
    pkg.scripts["corpus-coverage-report"] = "node tools/failing-report.js";
    writeJson(fixture.packagePath, pkg);
    const errors = errorsFor(fixture);
    assert.ok(errors.some((check) => check.message.includes("instead of tools/corpus-coverage-report.js")), JSON.stringify(errors));
    const result = runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) });
    assert.equal(result.inventoryPassed, false);
    assert.equal(result.passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("canonical aggregate metadata and package script cannot drift together", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tools/evil.js", "process.exit(0);\n");
    const manifest = readJson(fixture.manifestPath);
    manifest.canonical_aggregate.runner_file = "tools/evil.js";
    writeJson(fixture.manifestPath, manifest);
    const pkg = readJson(fixture.packagePath);
    pkg.scripts.test = "node tools/evil.js aggregate";
    writeJson(fixture.packagePath, pkg);
    const errors = errorsFor(fixture);
    assert.ok(errors.some((check) => check.message.includes("canonical_aggregate must exactly identify")), JSON.stringify(errors));
    assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("required report authority entry cannot be deleted", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    manifest.report_tools = manifest.report_tools.filter((tool) => tool.id !== "corpus-context-closure");
    writeJson(fixture.manifestPath, manifest);
    const errors = errorsFor(fixture);
    assert.ok(errors.some((check) => check.message.includes("required report authority entry missing: corpus-context-closure")), JSON.stringify(errors));
    assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("every verification-like package script requires an independent disposition", () => {
  const fixture = createFixture();
  try {
    const pkg = readJson(fixture.packagePath);
    pkg.scripts["required-but-unlisted-report"] = "node tools/required-but-unlisted-report.js";
    writeJson(fixture.packagePath, pkg);
    write(fixture.root, "tools/required-but-unlisted-report.js", 'process.stdout.write(JSON.stringify({passed:false}));process.exit(1);\n');
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.some((message) => message.includes("package script has no explicit verification disposition: required-but-unlisted-report")), errors.join("\n"));
    assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("all package scripts require explicit disposition regardless of naming", () => {
  for (const script of ["pretest", "posttest", "release:certify", "desktop:smoke", "quality-signal"]) {
    const fixture = createFixture();
    try {
      const pkg = readJson(fixture.packagePath);
      pkg.scripts[script] = "node tools/corpus-coverage-report.js";
      writeJson(fixture.packagePath, pkg);
      const errors = errorsFor(fixture).map((check) => check.message);
      assert.ok(errors.includes(`package script has no explicit verification disposition: ${script}`), errors.join("\n"));
    } finally {
      cleanup(fixture);
    }
  }
});

test("verification executable targets cannot be replaced in place by no-ops", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tools/verify-desktop-artifact.js", "// substituted no-op\nprocess.exit(0);\n");
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.some((message) => message.includes("protected file hash mismatch: tools/verify-desktop-artifact.js")), errors.join("\n"));
    assert.equal(runner.executeTier({ tier: "native", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("required reports cannot reuse one executable path", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    manifest.report_tools[1].file = manifest.report_tools[0].file;
    writeJson(fixture.manifestPath, manifest);
    const pkg = readJson(fixture.packagePath);
    pkg.scripts[manifest.report_tools[1].script] = `node ${manifest.report_tools[0].file}`;
    writeJson(fixture.packagePath, pkg);
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.includes(`duplicate report executable path: ${manifest.report_tools[0].file}`), errors.join("\n"));
  } finally {
    cleanup(fixture);
  }
});

test("nested test paths are recognized as exact repository-relative identities", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tests/nested/deeper/a.test.js", PASS_TEST);
    const manifest = readJson(fixture.manifestPath);
    manifest.test_files.push({ file: "tests/nested/deeper/a.test.js", status: "included", tier: "aggregate" });
    writeJson(fixture.manifestPath, manifest);
    const authority = readJson(fixture.authorityPath);
    authority.required_tests.aggregate.push("tests/nested/deeper/a.test.js");
    authority.test_hashes["tests/nested/deeper/a.test.js"] = hash(PASS_TEST);
    writeJson(fixture.authorityPath, authority);
    assert.deepEqual(errorsFor(fixture), []);
    assert.ok(inventory.listTestFiles(fixture.testsDir, fixture.root).includes("tests/nested/deeper/a.test.js"));
  } finally {
    cleanup(fixture);
  }
});

test("unlisted nested tests are detected", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tests/nested/unlisted.test.js", PASS_TEST);
    assert.ok(errorsFor(fixture).some((check) => check.message.includes("tests/nested/unlisted.test.js")));
  } finally {
    cleanup(fixture);
  }
});

test("a stale nested path cannot be satisfied by a top-level duplicate basename", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    manifest.test_files.find((entry) => entry.file === "tests/a.test.js").file = "tests/stale/a.test.js";
    writeJson(fixture.manifestPath, manifest);
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.some((message) => message.includes("no manifest entry: tests/a.test.js")), errors.join("\n"));
    assert.ok(errors.some((message) => message.includes("missing test file: tests/stale/a.test.js")), errors.join("\n"));
  } finally {
    cleanup(fixture);
  }
});

test("duplicate basenames in different directories remain distinct", () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tests/nested/a.test.js", PASS_TEST);
    const manifest = readJson(fixture.manifestPath);
    manifest.test_files.push({ file: "tests/nested/a.test.js", status: "included", tier: "aggregate" });
    writeJson(fixture.manifestPath, manifest);
    const authority = readJson(fixture.authorityPath);
    authority.required_tests.aggregate.push("tests/nested/a.test.js");
    authority.test_hashes["tests/nested/a.test.js"] = hash(PASS_TEST);
    writeJson(fixture.authorityPath, authority);
    assert.deepEqual(errorsFor(fixture), []);
  } finally {
    cleanup(fixture);
  }
});

test("quarantine and retirement require independent registry authority, not filler", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    const failure = manifest.test_files.find((entry) => entry.file === "tests/a.test.js");
    Object.assign(failure, {
      status: "quarantined",
      tier: "manual",
      reason: "aaaaaaaaaaaa",
      owner: "aaa",
      defect_id: "AA-BB",
      expiry: "aaaaaaaa",
    });
    writeJson(fixture.manifestPath, manifest);
    assert.ok(errorsFor(fixture).some((check) => check.message.includes("independently declared known defect")));

    Object.assign(failure, {
      status: "retired",
      reason: "aaaaaaaaaaaa",
      owner: "aaa",
      retirement_id: "AA-BB",
      permanent_retirement: true,
    });
    delete failure.defect_id;
    delete failure.expiry;
    writeJson(fixture.manifestPath, manifest);
    const retirementErrors = errorsFor(fixture).map((check) => check.message);
    assert.ok(retirementErrors.some((message) => message.includes("independently declared retirement record")));
  } finally {
    cleanup(fixture);
  }
});

test("coordinated disk and manifest deletion cannot remove a governed required test", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    manifest.test_files = manifest.test_files.filter((entry) => entry.file !== "tests/a.test.js");
    writeJson(fixture.manifestPath, manifest);
    fs.rmSync(path.join(fixture.root, "tests", "a.test.js"));
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.some((message) => message.includes("governed required test has no manifest entry: tests/a.test.js")), errors.join("\n"));
    assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("independent retirement record permits explicit permanent retirement and missing disk file", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    const entry = manifest.test_files.find((item) => item.file === "tests/a.test.js");
    Object.assign(entry, {
      status: "retired",
      owner: "verification authority",
      reason: "Fixture test is permanently retired by explicit authority.",
      retirement_id: "YB-RETIRE-A",
      permanent_retirement: true,
    });
    writeJson(fixture.manifestPath, manifest);
    fs.rmSync(path.join(fixture.root, "tests", "a.test.js"));
    const authority = readJson(fixture.authorityPath);
    authority.retirements.push({
      retirement_id: "YB-RETIRE-A",
      file: "tests/a.test.js",
      owner: "verification authority",
      summary: "Fixture test is permanently retired by explicit authority.",
      permanent_retirement: true,
    });
    delete authority.test_hashes["tests/a.test.js"];
    writeJson(fixture.authorityPath, authority);
    assert.deepEqual(errorsFor(fixture), []);
  } finally {
    cleanup(fixture);
  }
});

test("retirement registry record without replacement or permanent flag is rejected", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    Object.assign(manifest.test_files.find((item) => item.file === "tests/a.test.js"), {
      status: "retired",
      owner: "verification authority",
      reason: "Fixture retirement lacks required disposition authority.",
      retirement_id: "YB-RETIRE-INCOMPLETE",
    });
    writeJson(fixture.manifestPath, manifest);
    const authority = readJson(fixture.authorityPath);
    authority.retirements.push({
      retirement_id: "YB-RETIRE-INCOMPLETE",
      file: "tests/a.test.js",
      owner: "verification authority",
      summary: "Fixture retirement lacks required disposition authority.",
    });
    writeJson(fixture.authorityPath, authority);
    assert.ok(errorsFor(fixture).some((check) => check.message.includes("independently declared retirement record")));
  } finally {
    cleanup(fixture);
  }
});

test("required aggregate tier cannot migrate through manifest metadata alone", () => {
  for (const tier of ["long-world", "native", "manual"]) {
    const fixture = createFixture();
    try {
      const manifest = readJson(fixture.manifestPath);
      manifest.test_files.find((entry) => entry.file === "tests/a.test.js").tier = tier;
      writeJson(fixture.manifestPath, manifest);
      const errors = errorsFor(fixture).map((check) => check.message);
      assert.ok(errors.some((message) => message.includes(`required tier aggregate cannot change to ${tier}`)), errors.join("\n"));
      assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
    } finally {
      cleanup(fixture);
    }
  }
});

test("fast tier cannot become a vacuous zero-test success", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    for (const entry of manifest.test_files) delete entry.fast;
    writeJson(fixture.manifestPath, manifest);
    const errors = errorsFor(fixture).map((check) => check.message);
    assert.ok(errors.some((message) => message.includes("required fast test must remain included/aggregate/fast")), errors.join("\n"));
    assert.equal(runner.executeTier({ tier: "fast", ...fixtureOptions(fixture) }).passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("independent tier-transition record explicitly authorizes a required tier migration", () => {
  for (const tier of ["long-world", "native", "manual"]) {
    const fixture = createFixture();
    try {
      const manifest = readJson(fixture.manifestPath);
      const entry = manifest.test_files.find((item) => item.file === "tests/a.test.js");
      entry.tier = tier;
      entry.tier_transition_id = `YB-TEST-TIER-${tier.toUpperCase()}`;
      writeJson(fixture.manifestPath, manifest);
      const authority = readJson(fixture.authorityPath);
      authority.tier_transitions.push({
        transition_id: entry.tier_transition_id,
        file: "tests/a.test.js",
        from_tier: "aggregate",
        to_tier: tier,
        owner: "verification authority",
        review_condition: "Explicit fixture transition review",
      });
      writeJson(fixture.authorityPath, authority);
      assert.deepEqual(errorsFor(fixture), []);
    } finally {
      cleanup(fixture);
    }
  }
});

test("protected failing verification-core test cannot be hidden by quarantine or retirement", () => {
  for (const status of ["quarantined", "retired"]) {
    const fixture = createFixture();
    try {
      write(fixture.root, "tests/core.test.js", FAIL_TEST);
      const manifest = readJson(fixture.manifestPath);
      const core = manifest.test_files.find((entry) => entry.file === "tests/core.test.js");
      Object.assign(core, {
        status,
        tier: "manual",
        reason: "Protected failing verification core cannot be removed from the gate.",
        owner: "verification authority",
        defect_id: "YB-CORE-FAILURE",
        expiry: "Review only after verification authority changes",
        permanent_justification: "Permanent retirement requires an explicit authority change.",
      });
      writeJson(fixture.manifestPath, manifest);
      const checks = errorsFor(fixture);
      assert.ok(checks.some((check) => check.message.includes("must remain included/tier aggregate")), JSON.stringify(checks));
      assert.equal(runner.executeTier({ tier: "aggregate", ...fixtureOptions(fixture) }).passed, false);
    } finally {
      cleanup(fixture);
    }
  }
});

test("native authority is independent, exact, and all three fixture commands execute", () => {
  const fixture = createFixture();
  try {
    const manifest = readJson(fixture.manifestPath);
    const plan = runner.planTier(manifest, "native");
    assert.deepEqual(plan.requiredCommands, inventory.REQUIRED_NATIVE_COMMANDS);
    const result = runner.executeTier({ tier: "native", ...fixtureOptions(fixture) });
    assert.equal(result.passed, true, JSON.stringify(result.commandResults));
    assert.equal(result.commandResults.length, 3);
    assert.ok(result.commandResults.every((command) => command.executed && command.exitCode === 0 && command.passed));

    const pkg = readJson(fixture.packagePath);
    pkg.verification.nativeRequiredCommands.pop();
    writeJson(fixture.packagePath, pkg);
    assert.ok(errorsFor(fixture).some((check) => check.message.includes("package.json verification.nativeRequiredCommands")));

    writeJson(fixture.packagePath, basePackage());
    manifest.native_required_commands.pop();
    writeJson(fixture.manifestPath, manifest);
    assert.ok(errorsFor(fixture).some((check) => check.message.includes("manifest native_required_commands")));
  } finally {
    cleanup(fixture);
  }
});

test("native command names cannot conceal replacement script bodies or a no-op build", () => {
  for (const script of ["desktop:verify", "desktop:settings-regression", "desktop:first-run-regression", "desktop:build"]) {
    const fixture = createFixture();
    try {
      const pkg = readJson(fixture.packagePath);
      pkg.scripts[script] = "node tools/native-pass.js";
      writeJson(fixture.packagePath, pkg);
      const errors = errorsFor(fixture);
      assert.ok(errors.some((check) => check.message.includes(`native script '${script}' must exactly invoke`)), JSON.stringify(errors));
      assert.equal(runner.executeTier({ tier: "native", ...fixtureOptions(fixture) }).passed, false);
    } finally {
      cleanup(fixture);
    }
  }
});

test("test, report, and native command subprocesses receive positive configured timeouts", () => {
  const calls = [];
  const fakeSpawn = (executable, args, options) => {
    calls.push({ executable, args, timeout: options.timeout, killSignal: options.killSignal });
    return { status: 0, signal: null, error: null, stdout: JSON.stringify({ passed: true }), stderr: "" };
  };
  const timeouts = { test: 1111, report: 2222, command: 3333 };
  assert.equal(runner.runTestFiles(["tests/a.test.js"], { root: ROOT, spawnSync: fakeSpawn, timeouts }).passed, true);
  assert.equal(runner.runReportTool({ id: "fixture", script: "fixture", file: "tools/corpus-coverage-report.js" }, { root: ROOT, spawnSync: fakeSpawn, timeouts }).passed, true);
  assert.equal(runner.runCommand("desktop:verify", { root: ROOT, spawnSync: fakeSpawn, timeouts }).passed, true);
  assert.deepEqual(calls.map((call) => call.timeout), [1111, 2222, 3333]);
  assert.ok(calls.every((call) => call.killSignal === "SIGTERM"));
});

function runFixtureChild(fixture) {
  const script = [
    `const runner=require(${JSON.stringify(path.join(ROOT, "tools", "verification-runner.js"))});`,
    `const result=runner.executeTier({tier:"aggregate",root:${JSON.stringify(fixture.root)},manifestPath:${JSON.stringify(fixture.manifestPath)},packagePath:${JSON.stringify(fixture.packagePath)},testsDir:${JSON.stringify(fixture.testsDir)},requiredProtectedTests:${JSON.stringify(PROTECTED)},requiredVerificationCoreFiles:${JSON.stringify(CORE_FILES)}});`,
    "process.exit(result.passed?0:1);",
  ].join("");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", script], { cwd: ROOT, stdio: "ignore" });
    child.on("error", (error) => resolve({ code: null, error }));
    child.on("exit", (code) => resolve({ code, error: null }));
  });
}

function runHangingFixtureChild(fixture) {
  const script = [
    `const runner=require(${JSON.stringify(path.join(ROOT, "tools", "verification-runner.js"))});`,
    `const result=runner.executeTier({tier:"aggregate",root:${JSON.stringify(fixture.root)},authorityPath:${JSON.stringify(fixture.authorityPath)},manifestPath:${JSON.stringify(fixture.manifestPath)},packagePath:${JSON.stringify(fixture.packagePath)},testsDir:${JSON.stringify(fixture.testsDir)},requiredProtectedTests:${JSON.stringify(PROTECTED)},requiredVerificationCoreFiles:${JSON.stringify(CORE_FILES)},timeouts:{test:5000,report:250,command:5000}});`,
    "process.stdout.write(JSON.stringify(runner.printableSummary(result)));",
    "process.exit(result.passed?0:1);",
  ].join("");
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["-e", script], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: null, error, stdout, stderr, durationMs: Date.now() - started }));
    child.on("exit", (code) => resolve({ code, error: null, stdout, stderr, durationMs: Date.now() - started }));
  });
}

test("a real hanging report is terminated by the configured timeout and verification exits nonzero", async () => {
  const fixture = createFixture();
  try {
    write(fixture.root, "tools/corpus-coverage-report.js", HANG_REPORT);
    const authority = readJson(fixture.authorityPath);
    authority.executable_hashes["tools/corpus-coverage-report.js"] = hash(HANG_REPORT);
    writeJson(fixture.authorityPath, authority);
    const child = await runHangingFixtureChild(fixture);
    assert.equal(child.error, null, child.stderr);
    assert.equal(child.code, 1, `${child.stdout}\n${child.stderr}`);
    assert.ok(child.durationMs >= 200 && child.durationMs < 5000, `unexpected timeout duration ${child.durationMs}ms`);
    const summary = JSON.parse(child.stdout);
    const timedOutReport = summary.reportResults.find((result) => result.id === "corpus-context-closure");
    assert.equal(timedOutReport.passed, false);
    assert.equal(timedOutReport.timedOut, true);
    assert.equal(timedOutReport.timeoutMs, 250);
    assert.equal(summary.passed, false);
  } finally {
    cleanup(fixture);
  }
});

test("concurrent meta verification uses isolated roots and never mutates repository package.json", async () => {
  const first = createFixture();
  const second = createFixture();
  const before = fs.readFileSync(PACKAGE_PATH);
  try {
    const results = await Promise.all([runFixtureChild(first), runFixtureChild(second)]);
    assert.deepEqual(results.map((result) => result.code), [0, 0], JSON.stringify(results));
    assert.deepEqual(fs.readFileSync(PACKAGE_PATH), before);
  } finally {
    cleanup(first);
    cleanup(second);
  }
});
