#!/usr/bin/env node
"use strict";

// Mechanical comparison of a full test run's FAILING set against the committed baseline
// (docs/acceptance/reader-phase0/baseline-failing-tests.json), so "the same pre-existing failures, no new ones"
// is checked, not asserted.
//
//   node --test tests/*.test.js > run.txt 2>&1        (default spec reporter)
//   node tools/compare-failing-tests.js run.txt [--baseline <file>] [--json]
//   node tools/compare-failing-tests.js --write-baseline run.txt --out <file>   (records a baseline; governance)
//
// Exit code 1 when the run has a failure the baseline does not list. Failures the baseline lists that no longer
// fail are reported as "fixed" (not an error). A test is identified by its file (looked up from the test source)
// and its name.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_BASELINE = path.join(ROOT, "docs", "acceptance", "reader-phase0", "baseline-failing-tests.json");

/** Failing test names from a spec-reporter (✖ name (time)) or TAP (not ok N - name) run. */
function failingNames(text) {
  const names = new Set();
  for (const line of String(text).split("\n")) {
    let m = line.match(/^✖ (.+?)(?: \([\d.]+m?s\))?$/);
    if (m && m[1] !== "failing tests:") { names.add(m[1].trim()); continue; }
    m = line.match(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/);
    if (m) names.add(m[1].trim());
  }
  return [...names].sort();
}

/** The test file(s) declaring a test name (a literal search of tests/*.test.js). */
function fileOf(name, sources) {
  const hits = sources.filter(([, src]) => src.includes(`"${name}"`) || src.includes(`'${name}'`) || src.includes(`\`${name}\``) || src.includes(name));
  return hits.length ? hits.map(([file]) => file) : ["(unresolved: parameterized or generated name)"];
}
function testSources() {
  const dir = path.join(ROOT, "tests");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort().map((f) => [`tests/${f}`, fs.readFileSync(path.join(dir, f), "utf8")]);
}

function compare(runText, baseline) {
  const now = new Set(failingNames(runText));
  const known = new Set(baseline.failing.map((t) => t.name));
  return {
    baseline_count: known.size,
    run_count: now.size,
    new_failures: [...now].filter((n) => !known.has(n)).sort(),
    fixed: [...known].filter((n) => !now.has(n)).sort(),
    unchanged: [...now].filter((n) => known.has(n)).length
  };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (args.includes("--write-baseline")) {
    const run = arg("--write-baseline");
    const out = arg("--out") ?? DEFAULT_BASELINE;
    const sources = testSources();
    const failing = failingNames(fs.readFileSync(run, "utf8")).map((name) => ({ name, files: fileOf(name, sources) }));
    const doc = { version: "yellow-beast-baseline-failing-tests@v1", baseline_commit: arg("--commit") ?? null, command: "node --test tests/*.test.js", note: arg("--note") ?? null, count: failing.length, failing };
    fs.writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
    console.log(`wrote ${out}: ${failing.length} failing tests`);
    return;
  }
  const run = args.find((a) => !a.startsWith("--") && a !== arg("--baseline"));
  if (!run) { console.error("usage: node tools/compare-failing-tests.js <run output> [--baseline <file>] [--json]"); process.exit(2); }
  const baseline = JSON.parse(fs.readFileSync(arg("--baseline") ?? DEFAULT_BASELINE, "utf8"));
  const result = compare(fs.readFileSync(run, "utf8"), baseline);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 1) : `baseline ${result.baseline_count} failing; run ${result.run_count} failing; unchanged ${result.unchanged}; NEW ${result.new_failures.length}; fixed ${result.fixed.length}${result.new_failures.length ? `\nnew failures:\n  ${result.new_failures.join("\n  ")}` : ""}${result.fixed.length ? `\nfixed:\n  ${result.fixed.join("\n  ")}` : ""}`);
  process.exit(result.new_failures.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { failingNames, compare, fileOf };
