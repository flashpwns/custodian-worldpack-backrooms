#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- POWER CALCULATIONS behind the sealed-set statistical policy (READER_PHASE2_PREREGISTRATION.md §6).
// Deterministic; one-sided tests. Prints a JSON table.
//   normal approximations (planning context, Step 0)
//   EXACT binomial power of the false-confident gate (Step 0.1): reject H0 "FC >= 3%" when the one-sided exact
//   (Clopper-Pearson) 95% upper bound is <= 3%, i.e. when P(X <= k | n, 0.03) <= 0.05; power = P(X <= k* | n, p_true).
//   Clustering by author / prefix enters as a design effect: n_eff = n / (1 + (m - 1) * rho).
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

// ─── exact binomial ──────────────────────────────────────────────────────────────────────────────────
function logChoose(n, k) { let s = 0; for (let i = 1; i <= k; i += 1) s += Math.log(n - k + i) - Math.log(i); return s; }
/** P(X <= k) for X ~ Binomial(n, p). */
function binomCdf(k, n, p) { if (k < 0) return 0; if (k >= n) return 1; let s = 0; for (let i = 0; i <= k; i += 1) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p)); return Math.min(1, s); }
/** Largest k whose exact one-sided (1 - alpha) upper bound is <= p0 (-1 if none). */
function criticalK(n, p0, alpha = 0.05) { let k = -1; while (binomCdf(k + 1, n, p0) <= alpha) k += 1; return k; }
/** Exact power of "upper bound <= p0" with n accepted items when the truth is p1. */
function exactPowerBelow(n, p0, p1, alpha = 0.05) { const k = criticalK(n, p0, alpha); return { n, critical_k: k, power: k < 0 ? 0 : Math.round(binomCdf(k, n, p1) * 1000) / 1000 }; }
/** Kish design effect for clusters of mean size m and intra-cluster correlation rho. */
const designEffect = (m, rho) => 1 + (Math.max(1, m) - 1) * Math.max(0, rho);
/** Smallest TOTAL sealed size reaching `power` for the FC gate at coverage `cov`, with a design effect. */
function sealedSizeFC({ p0 = 0.03, p1 = 0.02, power = 0.8, alpha = 0.05, coverage = 0.88, deff = 1, step = 10 } = {}) {
  for (let total = 100; total <= 20000; total += step) {
    const nEff = Math.floor((total * coverage) / deff);
    if (exactPowerBelow(nEff, p0, p1, alpha).power >= power) return { total, accepted: Math.floor(total * coverage), n_effective: nEff };
  }
  return null;
}

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
  // Exact binomial power of the FC gate (Step 0.1): 1,000 turns at ~88% coverage (~880 accepted).
  for (const p1 of [0.01, 0.015, 0.02, 0.025]) add("G4 false-confident <= 3% EXACT (Clopper-Pearson), n = 1,000 turns", { total: 1000, accepted: 880, true_fc: p1, alpha: 0.05 }, exactPowerBelow(880, 0.03, p1, 0.05));
  for (const p1 of [0.01, 0.015, 0.02, 0.025]) add("G4 false-confident <= 3% EXACT, n = 1,800 turns", { total: 1800, accepted: 1584, true_fc: p1, alpha: 0.05 }, exactPowerBelow(1584, 0.03, p1, 0.05));
  // Sealed-size rule: smallest total with >= 80% exact power at a planning true FC of 2%, 88% coverage, by design effect.
  for (const [m, rho] of [[1, 0], [10, 0.01], [10, 0.02], [20, 0.02]]) add("sealed size rule: FC gate 80% exact power at true FC 2%", { cluster_size: m, icc: rho, design_effect: Math.round(designEffect(m, rho) * 1000) / 1000, coverage: 0.88, alpha: 0.05 }, sealedSizeFC({ deff: designEffect(m, rho) }));
  return out;
}

if (require.main === module) console.log(JSON.stringify(table(), null, 1));
module.exports = { rateBelow, rateAbove, pairedNonInferior, binomCdf, criticalK, exactPowerBelow, designEffect, sealedSizeFC, table, Z, ZB };
