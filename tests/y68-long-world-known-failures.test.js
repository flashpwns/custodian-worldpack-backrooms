"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const inventory = require("../tools/verification-inventory");
const runner = require("../tools/verification-runner");
const PASS_TEST = 'const test=require("node:test");test("pass",()=>{});\n';
const FIXTURE_RUNNER = "// fixture path identity only\n";

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test("known failed report remains FAILURE while expected defect evidence stays explicit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-known-failure-meta-"));
  const protectedFile = "tests/verification-core.test.js";
  try {
    const knownDefectTest = 'const test=require("node:test");test("known",()=>{});\n';
    write(root, protectedFile, PASS_TEST);
    write(root, "tests/known-defect.test.js", knownDefectTest);
    const executableSources = {};
    for (const tool of inventory.REQUIRED_REPORT_TOOLS) {
      const source = tool.id === "long-world-torture"
        ? 'process.stdout.write(JSON.stringify({passed:false}));process.exit(1);\n'
        : 'process.stdout.write(JSON.stringify({passed:true}));\n';
      write(root, tool.file, source);
      executableSources[tool.file] = source;
    }
    write(root, "tools/native-pass.js", "process.exit(0);\n");
    const nativeSource = "process.exit(0);\n";
    write(root, "tools/build-desktop.js", nativeSource);
    write(root, "tools/verify-desktop-artifact.js", nativeSource);
    write(root, "tools/verify-first-run-artifact.js", nativeSource);
    executableSources["tools/build-desktop.js"] = nativeSource;
    executableSources["tools/verify-desktop-artifact.js"] = nativeSource;
    executableSources["tools/verify-first-run-artifact.js"] = nativeSource;
    write(root, "tools/verification-runner.js", FIXTURE_RUNNER);

    const manifest = {
      version: "yellow-beast-verification-manifest@v2",
      governance: "verification/verification-authority.json",
      canonical_aggregate: { ...inventory.REQUIRED_CANONICAL_AGGREGATE },
      protected_test_files: [protectedFile],
      native_required_commands: [...inventory.REQUIRED_NATIVE_COMMANDS],
      test_files: [
        { file: protectedFile, status: "included", tier: "aggregate", fast: true },
        {
          file: "tests/known-defect.test.js",
          status: "quarantined",
          tier: "long-world",
          reason: "Known fixture defect remains executable evidence until its owning gate.",
          owner: "verification fixture",
          defect_id: "YB-FIXTURE-KNOWN-DEFECT",
          expiry: "Review at the fixture repair gate",
        },
      ],
      report_tools: inventory.REQUIRED_REPORT_TOOLS.map((tool) => ({ ...tool })),
    };
    const pkg = {
      name: "known-failure-fixture",
      version: "1.0.0",
      verification: { nativeRequiredCommands: [...inventory.REQUIRED_NATIVE_COMMANDS] },
      scripts: {
        test: inventory.REQUIRED_CANONICAL_AGGREGATE_COMMAND,
        "corpus-coverage-report": "node tools/corpus-coverage-report.js",
        "stranger-flow-report": "node tools/stranger-flow-report.js",
        "y32-replayability-report": "node tools/y32-replayability-report.js",
        "yb33-torture-report": "node tools/yb33-torture-report.js",
        "test:meta": `node --test ${protectedFile}`,
        "test:inventory": "node tools/verification-inventory.js",
        "test:fast": "node tools/verification-runner.js fast",
        "test:long-world": "node tools/verification-runner.js long-world",
        "test:native": "node tools/verification-runner.js native",
        ...inventory.REQUIRED_NATIVE_SCRIPT_BINDINGS,
      },
    };
    const authority = {
      version: "yellow-beast-verification-authority@v1",
      required_tests: { aggregate: [protectedFile], "long-world": ["tests/known-defect.test.js"], native: [], manual: [] },
      required_fast_tests: [protectedFile],
      test_hashes: {
        [protectedFile]: crypto.createHash("sha256").update(PASS_TEST).digest("hex"),
        "tests/known-defect.test.js": crypto.createHash("sha256").update(knownDefectTest).digest("hex"),
      },
      verification_core_hashes: {
        "tools/verification-runner.js": crypto.createHash("sha256").update(FIXTURE_RUNNER).digest("hex"),
        [protectedFile]: crypto.createHash("sha256").update(PASS_TEST).digest("hex"),
      },
      known_defects: [{
        defect_id: "YB-FIXTURE-KNOWN-DEFECT",
        file: "tests/known-defect.test.js",
        owner: "verification fixture",
        summary: "Known fixture defect remains executable evidence until its owning gate.",
        review_condition: "Review at the fixture repair gate",
      }],
      retirements: [],
      tier_transitions: [],
      executable_hashes: Object.fromEntries(Object.entries(executableSources).map(([file, source]) => [file, crypto.createHash("sha256").update(source).digest("hex")])),
      verification_script_dispositions: {
        canonical_aggregate: ["test"],
        tier_command: ["test:meta", "test:inventory", "test:fast", "test:long-world", "test:native"],
        required_report: inventory.REQUIRED_REPORT_TOOLS.map((tool) => tool.script),
        native_required: [...inventory.REQUIRED_NATIVE_COMMANDS],
        supporting_non_authoritative: ["desktop:build"],
        non_verification: [],
      },
    };
    write(root, "verification/test-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    write(root, "verification/verification-authority.json", `${JSON.stringify(authority, null, 2)}\n`);
    write(root, "package.json", `${JSON.stringify(pkg, null, 2)}\n`);

    const result = runner.executeTier({
      tier: "long-world",
      root,
      authorityPath: path.join(root, "verification", "verification-authority.json"),
      manifestPath: path.join(root, "verification", "test-manifest.json"),
      packagePath: path.join(root, "package.json"),
      testsDir: path.join(root, "tests"),
      requiredProtectedTests: [protectedFile],
      requiredVerificationCoreFiles: ["tools/verification-runner.js", protectedFile],
    });
    assert.equal(result.inventoryPassed, true);
    assert.equal(result.testsPassed, true);
    assert.equal(result.reportsPassed, false);
    assert.equal(result.knownFailuresExpected, true);
    assert.equal(result.passed, false);
    assert.equal(result.reportResults[0].declaredPassed, false);
    assert.equal(result.reportResults[0].exitCode, 1);
    assert.equal(result.reportResults[0].declarationExitConsistent, true);

    const human = runner.formatHumanOutput(result);
    assert.match(human, /^\[FAIL\] report long-world-torture:/m);
    assert.match(human, /FAILED tier=long-world/);
    assert.match(human, /reports=false/);
    assert.match(human, /knownFailuresExpected=true \(tests\/known-defect\.test\.js\)/);
    assert.doesNotMatch(human, /PASSED tier=long-world/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
