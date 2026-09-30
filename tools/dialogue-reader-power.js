#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- POWER CALCULATIONS behind the sealed-set statistical policy (READER_PHASE2_PREREGISTRATION.md §6).
// Deterministic normal approximations; one-sided tests. Prints a JSON table.
//
//   node tools/dialogue-reader-power.js

const Z = Object.freeze({ 0.05: 1.6449, 0.025: 1.96, 0.0167: 2.128, 0.01: 2.3263, 0.00714: 2.4500, 0.005: 2.5758, 0.001: 3.0902 });
const ZB = Object.freeze({ 0.8: 0.8416, 0.9: 1.2816, 0.95: 1.6449 });
const ceil = Math.ceil;

/** Accepted items needed to show a rate p < p0 when the truth is p1 (one-sided alpha, power). */
function rateBelow(p0, p1, alpha, power) { const a = Z[alpha] * Math.sqrt(p0 * (1 - p0)); const b = ZB[power] * Math.sqrt(p1 * (1 - p1)); return ceil(((a + b) / (p0 - p1)) ** 2); }
/** Items needed to show a proportion q > q0 when the truth is q1. */
function rateAbove(q0, q1, alpha, power) { return rateBelow(1 - q0, 1 - q1, alpha, power); }
/** Paired items needed to show (A - B) < margin when the true difference is d and the discordance is disc. */
function pairedNonInferior(margin, d, disc, alpha, power) { const sigma = Math.sqrt(disc - d * d); return ceil((((Z[alpha] + ZB[power]) * sigma) / (margin - d)) ** 2); }

function table() {
  const out = { version: "yellow-beast-reader-power@v1", method: "normal approximation, one-sided", rows: [] };
  const add = (gate, scenario, n, note = null) => out.rows.push({ gate, scenario, n, ...(note ? { note } : {}) });
  // G4 false-confident <= 3% among accepted (coverage >= 88% converts accepted -> total).
  for (const [p1, power] of [[0.015, 0.9], [0.015, 0.95], [0.012, 0.9], [0.01, 0.9], [0.01, 0.95]]) {
    const acc = rateBelow(0.03, p1, 0.05, power);
    add("G4 false-confident <= 3%", { true_fc: p1, alpha: 0.05, power }, { accepted: acc, total_at_88pct_coverage: ceil(acc / 0.88) });
  }
  add("G4 false-confident <= 3% (Bonferroni over 10 gates)", { true_fc: 0.015, alpha: 0.005, power: 0.9 }, { accepted: rateBelow(0.03, 0.015, 0.005, 0.9), total_at_88pct_coverage: ceil(rateBelow(0.03, 0.015, 0.005, 0.9) / 0.88) }, "what option A (many simultaneous Bonferroni gates) would demand");
  // G4 coverage >= 88%.
  for (const [q1, power] of [[0.92, 0.9], [0.93, 0.9], [0.91, 0.9]]) add("G4 coverage >= 88%", { true_coverage: q1, alpha: 0.05, power }, rateAbove(0.88, q1, 0.05, power));
  // Resolved-outcome non-inferiority, E4B vs teacher (paired), margin 6 points.
  for (const [d, disc, power] of [[0.02, 0.12, 0.9], [0.02, 0.08, 0.9], [0.03, 0.12, 0.9]]) add("G3 resolved outcome: teacher - E4B < 6 points", { true_diff: d, discordance: disc, alpha: 0.05, power }, pairedNonInferior(0.06, d, disc, 0.05, power));
  // Per-field non-inferiority (G3 as written), per APPLICABLE item, with and without a Bonferroni family of 7 fields.
  for (const [alpha, label] of [[0.05, "per field, no correction"], [0.00714, "per field, Bonferroni over 7 routing fields"]]) add(`G3 per-field non-inferiority (${label})`, { true_diff: 0.02, discordance: 0.08, alpha, power: 0.8 }, { applicable_per_field: pairedNonInferior(0.06, 0.02, 0.08, alpha, 0.8) }, "a rare field (e.g. inbound answer, ~8-10% prevalence) needs ~10x as many turns");
  // Accuracy lower bound >= 90% (teacher G2 resolved outcome).
  add("G2 teacher resolved outcome >= 90%", { true_acc: 0.94, alpha: 0.05, power: 0.9 }, rateAbove(0.90, 0.94, 0.05, 0.9));
  return out;
}

if (require.main === module) console.log(JSON.stringify(table(), null, 1));
module.exports = { rateBelow, rateAbove, pairedNonInferior, table, Z, ZB };
