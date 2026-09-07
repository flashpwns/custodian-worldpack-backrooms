"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");

const VERSION = "yellow-beast-referent-resolution@v1";

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function classifyPhrase(phrase) {
  const norm = normalized(phrase);
  if (/\b(him|he|his)\b/.test(norm)) return "person-male";
  if (/\b(her|she|hers)\b/.test(norm)) return "person-female";
  if (/\b(them|they|their|coworker|teammate|partner)\b/.test(norm)) return "person-any";
  if (/\b(there|over there|through there|that way)\b/.test(norm)) return "spatial-exit";
  if (/\b(camera|recorder|film|snapshot)\b/.test(norm)) return "equipment-camera";
  if (/\b(light|lamp|torch|illumination)\b/.test(norm)) return "equipment-light";
  if (/\b(meter|counter|survey instrument|instrument|gauge)\b/.test(norm)) return "equipment-instrument";
  if (/\b(radio|transmitter|transceiver)\b/.test(norm)) return "equipment-radio";
  if (/\b(it|this|that|thing|that thing|feature|seam|wall|fixture|door|opening)\b/.test(norm)) return "general-object";
  return "named-phrase";
}

function getCandidatePool(run, observerId) {
  const perceived = perceptionService.perceive(run, observerId);
  const candidates = [];

  // Coworkers
  for (const cw of perceived.visible.filter((item) => item.role !== undefined)) {
    const member = canonicalLedger.getObserverMember(run, cw.id);
    const gender = member?.gender ?? (/beverly|sarah|alice|ellen/i.test(cw.name) ? "female" : "male");
    candidates.push({
      id: cw.id,
      name: cw.name,
      aliases: [cw.name, cw.name.split(" ")[0], member?.first_name, member?.last_name, member?.role].filter(Boolean),
      category: "person",
      gender,
      distance_m: cw.distance_m ?? 2.0,
      visible: true
    });
  }

  // Equipment held by observer or coworkers in same room
  for (const [id, item] of Object.entries(run.expedition?.equipment ?? {})) {
    const holderLoc = canonicalLedger.getCoworkerLocation(run, item.holder) ?? (item.holder === observerId ? perceived.location_id : null);
    if (holderLoc === perceived.location_id) {
      candidates.push({
        id,
        name: item.label ?? item.model ?? id,
        aliases: [item.label, item.model, id].filter(Boolean),
        category: "equipment",
        capability: item.capability ?? null,
        holder: item.holder,
        distance_m: item.holder === observerId ? 0.0 : 2.0,
        visible: true
      });
    }
  }

  function addCandidate(cand) {
    const normCandName = normalized(cand.name);
    const existing = candidates.find((c) => {
      const normExisting = normalized(c.name);
      return c.id === cand.id ||
        normExisting === normCandName ||
        (normExisting.length > 5 && normCandName.length > 5 && (normExisting.includes(normCandName) || normCandName.includes(normExisting)));
    });
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...cand.aliases])];
      if (cand.name.length < existing.name.length) existing.name = cand.name;
      return;
    }
    candidates.push(cand);
  }

  // Visible objects & landmarks
  for (const item of perceived.visible.filter((i) => !i.role && !i.name.includes("passage") && !String(i.id).includes("-to-"))) {
    addCandidate({
      id: item.id,
      name: item.name,
      aliases: [item.name, item.id],
      category: "object",
      distance_m: item.distance_m ?? 1.0,
      visible: true
    });
  }

  // Visible exits
  for (const exit of perceived.visible.filter((i) => i.name.includes("passage") || String(i.id).includes("-to-"))) {
    addCandidate({
      id: exit.id,
      name: exit.name,
      aliases: [exit.name, exit.id, exit.direction].filter(Boolean),
      category: "exit",
      distance_m: exit.distance_m ?? 3.5,
      visible: true
    });
  }

  return candidates;
}

function scoreCandidate(candidate, phrase, phraseClass, context = {}) {
  let score = 0.0;
  const normPhrase = normalized(phrase);
  const cleanPhrase = normPhrase.replace(/^(the|a|an|that|this)\s+/, "");
  const normName = normalized(candidate.name);

  // Direct alias / name match
  const directMatch = candidate.aliases.some((alias) => {
    const normAlias = normalized(alias);
    return normAlias && (normPhrase === normAlias || normPhrase.includes(normAlias) || normAlias.includes(normPhrase) || normAlias.includes(cleanPhrase) || (cleanPhrase.length > 3 && normAlias.includes(cleanPhrase)));
  });
  if (directMatch) score += 0.65;

  // Category congruence
  if (phraseClass === "person-male") {
    if (candidate.category === "person" && candidate.gender === "male") score += 0.50;
    else return 0.0;
  } else if (phraseClass === "person-female") {
    if (candidate.category === "person" && candidate.gender === "female") score += 0.50;
    else return 0.0;
  } else if (phraseClass === "person-any") {
    if (candidate.category === "person") score += 0.45;
    else return 0.0;
  } else if (phraseClass === "spatial-exit") {
    if (candidate.category === "exit") score += 0.55;
  } else if (phraseClass === "equipment-camera") {
    if (candidate.category === "equipment" && (candidate.capability?.includes("photo") || /camera|record/i.test(candidate.name))) score += 0.70;
  } else if (phraseClass === "equipment-instrument") {
    if (candidate.category === "equipment" && (candidate.capability?.includes("measurement") || /survey|instrument|meter/i.test(candidate.name))) score += 0.70;
  } else if (phraseClass === "equipment-light") {
    if (candidate.category === "equipment" && (candidate.capability?.includes("illumination") || /light|lamp/i.test(candidate.name))) score += 0.70;
  } else if (phraseClass === "equipment-radio") {
    if (candidate.category === "equipment" && (candidate.capability?.includes("radio") || /radio/i.test(candidate.name))) score += 0.70;
  } else if (phraseClass === "general-object") {
    if (candidate.category === "object" || candidate.category === "equipment") score += 0.35;
    if (candidate.category === "exit" && /opening|passage|door/.test(normPhrase)) score += 0.40;
  }

  // Recency in context
  if (context.last_target && (context.last_target === candidate.id || context.last_target === candidate.name)) {
    score += 0.30;
  }
  if (context.recent_targets && context.recent_targets.includes(candidate.id)) {
    score += 0.20;
  }
  if (context.recent_text && normalized(context.recent_text).includes(normName)) {
    score += 0.15;
  }

  // Proximity & visibility (only if candidate has base relevance)
  if (score > 0.10) {
    if (candidate.distance_m < 1.5) score += 0.15;
    else if (candidate.distance_m < 3.0) score += 0.08;
  }

  return Math.min(1.0, Math.round(score * 100) / 100);
}

function resolveReferent(phrase, run, observerId = "player", context = {}) {
  const norm = normalized(phrase);
  if (!norm) return { phrase, resolved: false, top_candidate: null, candidates: [] };

  const phraseClass = classifyPhrase(phrase);
  const pool = getCandidatePool(run, observerId);

  const scored = [];
  for (const cand of pool) {
    const score = scoreCandidate(cand, phrase, phraseClass, context);
    if (score > 0.05) {
      scored.push({
        id: cand.id,
        name: cand.name,
        category: cand.category,
        score
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { phrase, resolved: false, top_candidate: null, candidates: [] };
  }

  const top = scored[0];
  const runnerUp = scored[1] ?? null;

  // Unambiguous resolution check
  const clearWinner = (top.score >= 0.65 && (!runnerUp || (top.score - runnerUp.score >= 0.20))) || (scored.length === 1 && top.score >= 0.40);

  return {
    phrase,
    resolved: clearWinner,
    top_candidate: clearWinner ? top : null,
    candidates: scored.slice(0, 5)
  };
}

module.exports = {
  VERSION,
  classifyPhrase,
  resolveReferent
};
