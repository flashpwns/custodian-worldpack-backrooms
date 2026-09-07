"use strict";

const fs = require("fs");
const path = require("path");
const canonLexicon = require("./canon-lexicon");
const canonLinter = require("./canon-linter");
const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");

const VERSION = "yellow-beast-interpretive-director@v1";

// Load data files safely
function loadJsonSafe(filePath, fallback) {
  try {
    const fullPath = path.resolve(__dirname, "..", filePath);
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, "utf8"));
    }
  } catch (err) {
    // fallback
  }
  return fallback;
}

const AUTHORED_CHUNKS = loadJsonSafe("data/interpretation/authored-chunks.json", []);
const COWORKER_POOLS = loadJsonSafe("data/dialogue/coworker-acknowledgements.json", {});
const ONBOARDING_PROCEDURES = loadJsonSafe("data/procedures/onboarding-procedures.json", { phases: {} });

const SOURCE_PRIORITY = Object.freeze({
  AUTHORED_CANON: 1,
  AUTHORED_VARIANT: 2,
  DETERMINISTIC: 3,
  AI_PERFORMANCE: 4,
  AI_SEMANTIC: 5,
  SYSTEM: 6
});

function normalize(str) {
  return String(str ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
}

/**
 * Classifies player input to determine appropriate AI activation level and routing.
 */
function classifyInput(text, phaseId, run) {
  const norm = normalize(text);

  if (["FIELD_OPERATION", "RETURN", "REPORT", "DEBRIEF"].includes(phaseId)) {
    return {
      classification: "EMERGENT_FIELD_PLAY",
      targetAction: null,
      targetPerson: null
    };
  }

  const proc = ONBOARDING_PROCEDURES.phases?.[phaseId];
  if (proc) {
    // Check if input matches expected phase progression
    const matchesExpected = proc.action_aliases?.some((alias) => {
      const normAlias = normalize(alias);
      return norm === normAlias || norm.startsWith(normAlias) || norm.includes(normAlias);
    });

    if (matchesExpected) {
      return {
        classification: "ON_SCRIPT",
        targetAction: proc.expected_action,
        targetPerson: null
      };
    }
  }

  // Check for minor deviations (routine procedural questions)
  if (/\b(what room|where are we|what is this room|what is this place|where is this|what place is this|what are my orders|what are our orders|what is our assignment|what time is it)\b/i.test(norm)) {
    return {
      classification: "MINOR_DEVIATION",
      targetAction: "QUESTION_PROCEDURAL",
      targetPerson: null
    };
  }

  // Check for major deviations (refusing orders, telling coworkers to stop/stay/wait)
  if (/\b(wait here|stay here|do not follow|do not move|hold here|stop|refuse|do not want|don't want|go back|back upstairs|leave)\b/i.test(norm)) {
    return {
      classification: "MAJOR_DEVIATION",
      targetAction: "DEVIATION_COMMAND",
      targetPerson: null
    };
  }

  return {
    classification: "MINOR_DEVIATION",
    targetAction: "UNCLASSIFIED_PREFIELD",
    targetPerson: null
  };
}

/**
 * Checks condition satisfaction for an authored beat against canonical world state.
 */
function validateBeatConditions(chunk, run) {
  if (!chunk || !run) return false;

  // Consumed check
  const consumed = new Set(run.expedition?.consumed_authored_beats ?? []);
  if (consumed.has(chunk.id) && chunk.repeat_policy === "once_per_expedition") {
    return false;
  }

  // Location check (threshold crossing beat applies on crossing regardless of instant field-entry move)
  if (chunk.location && chunk.trigger !== "threshold_crossed") {
    const playerLoc = canonicalLedger.getPlayerLocation(run);
    if (playerLoc && playerLoc !== chunk.location) return false;
  }

  // Phase check
  if (chunk.phase) {
    const currentPhase = run.expedition?.mission_state?.phase ?? run.phase?.phase_id;
    if (currentPhase && currentPhase !== chunk.phase) return false;
  }

  // Conditions (e.g. required personnel present)
  if (chunk.conditions?.required_present) {
    for (const person of chunk.conditions.required_present) {
      const present = perceptionService.sameRoom("player", person, run);
      if (!present) return false;
    }
  }

  return true;
}

/**
 * Finds an authored beat for a given trigger and context.
 */
function findAuthoredBeat(trigger, context = {}, run, { consume = true } = {}) {
  if (!run) return null;

  const candidates = AUTHORED_CHUNKS.filter((chunk) => {
    if (chunk.trigger !== trigger) return false;
    if (context.location && chunk.location && chunk.location !== context.location) return false;
    if (context.phase && chunk.phase && chunk.phase !== context.phase) return false;
    return validateBeatConditions(chunk, run);
  });

  if (candidates.length === 0) return null;

  // Sort by priority (canonical beats first)
  candidates.sort((a, b) => {
    const prioA = a.priority === "canonical" ? 1 : 2;
    const prioB = b.priority === "canonical" ? 1 : 2;
    return prioA - prioB;
  });

  const selected = candidates[0];
  const useVariant = (context.use_variant || (run.expedition?.clock?.interval ?? 0) % 2 === 1) && (selected.variants?.length > 0);
  const text = useVariant ? selected.variants[0] : selected.text;
  const source = useVariant ? "AUTHORED_VARIANT" : "AUTHORED_CANON";
  const cleanedText = canonLinter.enforceCanonText(text);

  let event = null;
  if (consume) {
    ensureDirectorState(run);
    run.expedition.consumed_authored_beats.push(selected.id);
    event = emitPresentationEvent(run, {
      type: "interpretation",
      source,
      text: cleanedText,
      chunk_id: selected.id,
      channel: "LOCAL",
      timestamp: Date.now()
    });
  }

  return {
    chunk: selected,
    source,
    text: cleanedText,
    event
  };
}

function consumeAuthoredBeat(run, beat) {
  if (!run || !beat?.chunk?.id) return;
  ensureDirectorState(run);
  if (!run.expedition.consumed_authored_beats.includes(beat.chunk.id)) {
    run.expedition.consumed_authored_beats.push(beat.chunk.id);
  }
}

/**
 * Gets a deterministic coworker acknowledgement.
 */
function getCoworkerAcknowledgement(coworkerName, responseClass, seed = 0) {
  const normName = Object.keys(COWORKER_POOLS).find((k) => k.toLowerCase() === coworkerName.toLowerCase()) ?? "Santiago";
  const classPool = COWORKER_POOLS[normName]?.[responseClass] ?? COWORKER_POOLS[normName]?.["ACKNOWLEDGE_ORDER"] ?? [
    "Understood."
  ];

  const index = Math.abs(seed) % classPool.length;
  const rawText = classPool[index];
  return {
    speaker: normName,
    channel: "LOCAL",
    source: "DETERMINISTIC",
    text: canonLinter.enforceCanonText(rawText)
  };
}

function ensureDirectorState(run) {
  if (!run.expedition) run.expedition = {};
  if (!Array.isArray(run.expedition.consumed_authored_beats)) {
    run.expedition.consumed_authored_beats = [];
  }
  if (!Array.isArray(run.expedition.presentation_events)) {
    run.expedition.presentation_events = [];
  }
  if (!run.expedition.dialogue_bus) {
    run.expedition.dialogue_bus = [];
  }
}

/**
 * Emits a structured presentation event to the dialogue event bus.
 */
function emitPresentationEvent(run, event) {
  ensureDirectorState(run);
  const cleanedText = canonLinter.enforceCanonText(event.text);
  const enriched = {
    id: `evt-${run.expedition.presentation_events.length + 1}`,
    type: event.type ?? "dialogue",
    speaker: event.speaker ?? null,
    channel: event.channel ?? "LOCAL",
    source: event.source ?? "DETERMINISTIC",
    text: cleanedText,
    chunk_id: event.chunk_id ?? null,
    timestamp: event.timestamp ?? Date.now()
  };

  run.expedition.presentation_events.push(enriched);
  run.expedition.dialogue_bus.push(enriched);
  return enriched;
}

module.exports = {
  VERSION,
  SOURCE_PRIORITY,
  AUTHORED_CHUNKS,
  COWORKER_POOLS,
  ONBOARDING_PROCEDURES,
  classifyInput,
  validateBeatConditions,
  findAuthoredBeat,
  consumeAuthoredBeat,
  getCoworkerAcknowledgement,
  emitPresentationEvent,
  ensureDirectorState
};
