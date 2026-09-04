"use strict";

const crypto = require("node:crypto");
const bootstrap = require("./run-bootstrap");
const teamRuntime = require("./team-runtime");

const PROPOSAL_VERSION = "yellow-beast-interpreter-proposal@v1";
const CONTEXT_VERSION = "yellow-beast-interpreter-context@v1";
const RESULT_VERSION = "yellow-beast-interpreter-result@v1";
const SINGLE_SINK = "custodian-action@v1";
const COORDINATED_SINK = "custodian-coordinated-attempts@v1";
const RELATIONS = new Set(["single", "coordinated"]);
const AGENCY = new Set(["direct-player", "first-person", "player-order"]);
const issuedCandidates = new WeakSet();

/** @typedef {{kind:"player"}|{kind:"coworker", reference:string}} ProposedActor */
/** @typedef {{actor:ProposedActor, action:string, target_label:string|null, equipment_label:string|null, agency:"direct-player"|"first-person"|"player-order", language_span:string}} ProposedAttempt */
/** @typedef {{version:typeof PROPOSAL_VERSION, status:"proposal", noncanonical:true, relation:"single"|"coordinated", attempts:ProposedAttempt[]}} InterpretationProposal */
/** @typedef {{version:typeof RESULT_VERSION, kind:"candidate", noncanonical:true, source_text:string, request_id:string, sink:{kind:typeof SINGLE_SINK|typeof COORDINATED_SINK, payload:object}, validation:{scope_digest:string, observer_context_version:typeof CONTEXT_VERSION, player_commitments:"explicit-language-only", canonical_state:"unmodified"}, provenance:{source:string, proposal_version:typeof PROPOSAL_VERSION}}} CandidateInterpretation */
/** @typedef {{version:typeof RESULT_VERSION, kind:"clarification", noncanonical:true, source_text:string, request_id:string, code:string, question:string, options:string[], provenance:{source:string}}} ClarificationInterpretation */

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function only(value, keys) {
  return plain(value) && Object.keys(value).every((key) => keys.has(key));
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeRequestId(requestId, sourceText) {
  if (typeof requestId === "string" && requestId.trim()) return requestId.trim().slice(0, 160);
  return `interpret-${digest(sourceText).slice(0, 20)}`;
}

function sourceName(interpreter) {
  return typeof interpreter?.name === "string" && interpreter.name.trim() ? interpreter.name.trim().slice(0, 80) : "unknown-language-authority";
}

function clarification({ sourceText, requestId, source, code, question, options = [] }) {
  return deepFreeze({
    version: RESULT_VERSION,
    kind: "clarification",
    noncanonical: true,
    source_text: sourceText,
    request_id: requestId,
    code,
    question,
    options: distinct(options).slice(0, 12),
    provenance: { source }
  });
}

function malformed(sourceText, requestId, source, code = "MALFORMED_INTERPRETATION") {
  return clarification({
    sourceText,
    requestId,
    source,
    code,
    question: "Please restate the action and identify who should do it and which currently observable target is involved."
  });
}

function publicCoworkerLabel(member) {
  return String(member.display_name ?? "Assigned teammate").replace(/\s*·\s*YOU\s*$/i, "").trim();
}

function buildCustodianScope(runValue) {
  if (!plain(runValue)) throw new TypeError("A canonical run is required.");
  // All projection helpers receive a clone. Even a migration or lazy default in
  // a read helper therefore cannot alter the canonical run during interpretation.
  const run = structuredClone(runValue);
  const observed = bootstrap.look(run, { record: false });
  const state = bootstrap.status(run);
  const player = run.session?.startup?.player?.observer_id;
  const location = observed.view?.location ?? {};
  const visible = distinct((observed.aliases ?? []).map((item) => item.alias));
  const features = distinct((observed.view?.features ?? []).map((item) => item.alias));
  const exits = (observed.view?.exits ?? []).map((item) => ({ label: item.alias, ref: item.edge_id }));
  const aliases = (observed.aliases ?? []).map((item) => ({ label: item.alias, ref: item.ref, aliases: [item.alias] }));
  const localCoworkers = (run.expedition ? teamRuntime.project(run) : [])
    .filter((member) => !member.controlled && member.local_eligible)
    .map((member) => {
      const label = publicCoworkerLabel(member);
      return {
        label,
        role: String(member.role ?? "assigned teammate").replace(/\s*·\s*YOU\s*$/i, "").trim(),
        ref: member.personnel_id,
        aliases: distinct([label, member.first_name, member.last_name, member.role])
      };
    });
  const playerEquipment = Object.entries(run.expedition?.equipment ?? {})
    .filter(([, item]) => item?.holder === player && !["missing", "abandoned", "depleted", "damaged", "jammed"].includes(String(item.state).toLowerCase()))
    .map(([ref, item]) => ({ label: item.label ?? item.model ?? "Available equipment", capability: item.capability ?? null, ref, aliases: distinct([item.label, item.model]) }));
  const targetFor = (label) => aliases.find((item) => normalized(item.label) === normalized(label));
  const singleActions = state.available_verbs.map((action) => {
    const type = String(action).toUpperCase();
    let targets = [];
    let equipment = [];
    let target_required = false;
    if (type === "MOVE") { targets = exits; target_required = true; }
    else if (type === "INSPECT") { targets = aliases; target_required = true; }
    else if (type === "USE") { targets = playerEquipment; target_required = targets.length > 0; }
    else if (type === "PHOTOGRAPH" || type === "TEST") { targets = aliases; target_required = true; }
    else if (type === "TRANSFER" || type === "HANDOFF") { targets = localCoworkers; equipment = playerEquipment; target_required = true; }
    else if (type.startsWith("ORDER_")) { targets = localCoworkers; target_required = false; }
    return { type, target_required, targets, ...(equipment.length ? { equipment } : {}) };
  });
  const referenceEquipment = playerEquipment.filter((item) => item.ref === "survey-instrument");
  const currentLocation = location.alias && location.id ? { label: location.alias, ref: location.id, aliases: distinct([location.alias]) } : null;
  const coordinated = run.spatial?.reference_expedition && currentLocation ? {
    player_actions: referenceEquipment.length ? [{ type: "USE", targets: [currentLocation], equipment: referenceEquipment }] : [],
    coworker_actions: localCoworkers.length ? [{ type: "INSPECT", targets: features.map((label) => targetFor(label)).filter(Boolean) }] : []
  } : { player_actions: [], coworker_actions: [] };
  const context = {
    version: CONTEXT_VERSION,
    authority_contract: {
      interpretation: "candidate-only",
      canonical_resolution: "Custodian-only",
      player_commitments: "explicit-player-language-only",
      hidden_state: "structurally-absent"
    },
    phase: run.expedition?.mission_state?.phase ?? null,
    lifecycle: run.lifecycle ?? "active",
    observer: { label: "You", location: location.alias ?? null },
    visible_targets: visible,
    local_coworkers: localCoworkers.map(({ label, role }) => ({ label, role })),
    available_equipment: playerEquipment.map(({ label, capability }) => ({ label, capability })),
    sinks: {
      single_attempt: singleActions.map((action) => ({ type: action.type, target_required: action.target_required, target_labels: action.targets.map((item) => item.label) })),
      coordinated_attempt: {
        player_actions: coordinated.player_actions.map((action) => ({ type: action.type, target_labels: action.targets.map((item) => item.label), equipment_labels: action.equipment.map((item) => item.label) })),
        coworker_actions: coordinated.coworker_actions.map((action) => ({ type: action.type, target_labels: action.targets.map((item) => item.label) }))
      }
    }
  };
  const authority = {
    run_ref: run.run_id ?? run.session?.id ?? null,
    interval: run.expedition?.clock?.interval ?? null,
    player,
    single_actions: singleActions,
    coworkers: localCoworkers,
    coordinated
  };
  return deepFreeze({ context, authority, digest: digest({ context, authority }) });
}

function proposalShape(value) {
  if (!only(value, new Set(["version", "status", "noncanonical", "relation", "attempts"]))) return false;
  if (value.version !== PROPOSAL_VERSION || value.status !== "proposal" || value.noncanonical !== true || !RELATIONS.has(value.relation)) return false;
  if (!Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > 4) return false;
  return value.attempts.every((attempt) => {
    if (!only(attempt, new Set(["actor", "action", "target_label", "equipment_label", "agency", "language_span"]))) return false;
    if (!only(attempt.actor, new Set(["kind", "reference"]))) return false;
    if (attempt.actor.kind === "player" && Object.hasOwn(attempt.actor, "reference")) return false;
    if (attempt.actor.kind === "coworker" && (typeof attempt.actor.reference !== "string" || !attempt.actor.reference.trim())) return false;
    if (!['player', 'coworker'].includes(attempt.actor.kind) || typeof attempt.action !== "string" || !attempt.action.trim()) return false;
    if (!(attempt.target_label === null || typeof attempt.target_label === "string") || !(attempt.equipment_label === null || typeof attempt.equipment_label === "string")) return false;
    return AGENCY.has(attempt.agency) && typeof attempt.language_span === "string" && attempt.language_span.trim().length > 0;
  });
}

function actionTerms(action) {
  return {
    INSPECT: ["inspect", "examine", "check"],
    USE: ["use", "measure", "test", "take a reading"],
    MOVE: ["move", "go", "walk", "enter", "proceed"],
    LOOK: ["look", "orient", "take stock"],
    WAIT: ["wait", "hold"],
    RETURN: ["return", "go back"],
    ABORT: ["abort", "withdraw"],
    PHOTOGRAPH: ["photograph", "photo", "picture", "camera", "take a photograph", "take a picture"],
    TEST: ["test", "meter", "test the light"],
    TRANSFER: ["transfer", "give", "hand", "pass"],
    HANDOFF: ["handoff", "hand off"],
    ORDER_HOLD: ["hold", "stay", "wait", "hold position", "stay here"],
    ORDER_FOLLOW: ["follow", "follow me", "come with me", "regroup"],
    ORDER_INVESTIGATE: ["investigate", "check route"]
  }[action] ?? [action.toLowerCase().replace(/_/g, " ")];
}

function containsTerm(text, terms) {
  const source = normalized(text);
  return terms.some((term) => source.includes(normalized(term)));
}

function languageSpanIsPresent(playerText, span) {
  return normalized(playerText).includes(normalized(span));
}

function agencySupported(attempt, playerText) {
  if (!languageSpanIsPresent(playerText, attempt.language_span)) return false;
  const span = normalized(attempt.language_span);
  const terms = actionTerms(String(attempt.action).toUpperCase());
  if (!containsTerm(span, terms)) return false;
  if (attempt.actor.kind === "player") {
    if (attempt.agency === "first-person") return /\b(i|i will|i ll|let me)\b/.test(span);
    if (attempt.agency !== "direct-player") return false;
    return terms.some((term) => span.startsWith(normalized(term)))
      || /\b(give|pass|hand|take|bring|photograph|photo|picture)\b/.test(span)
      || /\b(stay|hold|follow)\b/.test(span);
  }
  if (attempt.agency !== "player-order") return false;
  const actor = normalized(attempt.actor.reference);
  const directVocative = span.startsWith(actor) && terms.some((term) => span.includes(normalized(term)));
  return span.includes(actor) && (/\b(have|tell|ask|order|send|let)\b/.test(span) || directVocative);
}

function matchReference(query, records) {
  const needle = normalized(query);
  if (!needle) return { kind: "missing", matches: [] };
  const exact = records.filter((record) => (record.aliases ?? [record.label]).some((alias) => normalized(alias) === needle));
  const matches = exact.length ? exact : records.filter((record) => (record.aliases ?? [record.label]).some((alias) => {
    const candidate = normalized(alias);
    return candidate.includes(needle) || needle.includes(candidate);
  }));
  if (matches.length === 1) return { kind: "resolved", value: matches[0] };
  return { kind: matches.length > 1 ? "ambiguous" : "missing", matches };
}

function referenceClarification(sourceText, requestId, source, match, allRecords) {
  const ambiguous = match.kind === "ambiguous";
  return clarification({
    sourceText,
    requestId,
    source,
    code: ambiguous ? "REFERENCE_AMBIGUOUS" : "REFERENCE_NOT_OBSERVER_SAFE",
    question: ambiguous ? "Which currently observable person or target did you mean?" : "That reference is not available from the player's current observation. Which visible option did you mean?",
    options: (ambiguous ? match.matches : allRecords).map((item) => item.label)
  });
}

function resolveAttempt({ attempt, action, coworkers, sourceText, requestId, source }) {
  let actor = action.actor;
  if (attempt.actor.kind === "coworker") {
    const match = matchReference(attempt.actor.reference, coworkers);
    if (match.kind !== "resolved") return { clarification: referenceClarification(sourceText, requestId, source, match, coworkers) };
    actor = match.value.ref;
  }
  let target = null;
  if (action.target_required || attempt.target_label) {
    const match = matchReference(attempt.target_label, action.targets);
    if (match.kind !== "resolved") return { clarification: referenceClarification(sourceText, requestId, source, match, action.targets) };
    target = match.value.ref;
  }
  let equipment = null;
  if (action.equipment?.length || attempt.equipment_label) {
    const match = matchReference(attempt.equipment_label, action.equipment ?? []);
    if (match.kind !== "resolved") return { clarification: referenceClarification(sourceText, requestId, source, match, action.equipment ?? []) };
    equipment = match.value.ref;
  }
  return { attempt: { actor, action: String(attempt.action).toUpperCase(), target, ...(equipment ? { equipment } : {}) } };
}

function validateAndResolve(proposal, scope, meta) {
  const { sourceText, requestId, source } = meta;
  if (!proposalShape(proposal)) return malformed(sourceText, requestId, source);
  if (proposal.attempts.some((attempt) => !agencySupported(attempt, sourceText))) {
    return clarification({ sourceText, requestId, source, code: "PLAYER_AGENCY_UNSUPPORTED", question: "What action, if any, do you want your character to take?" });
  }
  const playerAttempts = proposal.attempts.filter((attempt) => attempt.actor.kind === "player");
  const coworkerAttempts = proposal.attempts.filter((attempt) => attempt.actor.kind === "coworker");
  if (proposal.relation === "single") {
    if (proposal.attempts.length !== 1 || playerAttempts.length !== 1) return malformed(sourceText, requestId, source, "UNSUPPORTED_ATTEMPT_SHAPE");
    const proposed = playerAttempts[0];
    const action = scope.authority.single_actions.find((item) => item.type === proposed.action.toUpperCase());
    if (!action) return clarification({ sourceText, requestId, source, code: "ACTION_NOT_AVAILABLE", question: "Which currently available action did you mean?", options: scope.authority.single_actions.map((item) => item.type) });
    const resolved = resolveAttempt({ attempt: proposed, action: { ...action, actor: scope.authority.player }, coworkers: [], sourceText, requestId, source });
    if (resolved.clarification) return resolved.clarification;
    const targetPayload = (resolved.attempt.action === "TRANSFER" || resolved.attempt.action === "HANDOFF")
      ? `${resolved.attempt.equipment ?? ""}|${resolved.attempt.target ?? ""}`
      : resolved.attempt.action.startsWith("ORDER_")
      ? `${resolved.attempt.target ?? ""}|`
      : (resolved.attempt.action === "USE" && !resolved.attempt.target && resolved.attempt.equipment)
      ? resolved.attempt.equipment
      : resolved.attempt.target;
    return { kind: SINGLE_SINK, payload: { action: resolved.attempt.action, target: targetPayload } };
  }
  if (playerAttempts.length !== 1 || coworkerAttempts.length < 1 || proposal.attempts.length !== playerAttempts.length + coworkerAttempts.length) return malformed(sourceText, requestId, source, "UNSUPPORTED_ATTEMPT_SHAPE");
  const playerProposal = playerAttempts[0];
  const playerAction = scope.authority.coordinated.player_actions.find((item) => item.type === playerProposal.action.toUpperCase());
  if (!playerAction) return clarification({ sourceText, requestId, source, code: "ACTION_NOT_AVAILABLE", question: "Which currently available coordinated player action did you mean?", options: scope.context.sinks.coordinated_attempt.player_actions.map((item) => item.type) });
  const resolvedPlayer = resolveAttempt({ attempt: playerProposal, action: { ...playerAction, actor: scope.authority.player, target_required: true }, coworkers: [], sourceText, requestId, source });
  if (resolvedPlayer.clarification) return resolvedPlayer.clarification;
  const resolvedCoworkers = [];
  for (const proposed of coworkerAttempts) {
    const action = scope.authority.coordinated.coworker_actions.find((item) => item.type === proposed.action.toUpperCase());
    if (!action) return clarification({ sourceText, requestId, source, code: "ACTION_NOT_AVAILABLE", question: "Which currently available coworker action did you mean?", options: scope.context.sinks.coordinated_attempt.coworker_actions.map((item) => item.type) });
    const resolved = resolveAttempt({ attempt: proposed, action: { ...action, actor: null, target_required: true }, coworkers: scope.authority.coworkers, sourceText, requestId, source });
    if (resolved.clarification) return resolved.clarification;
    resolvedCoworkers.push(resolved.attempt);
  }
  return {
    kind: COORDINATED_SINK,
    payload: {
      submission_id: `interpreted-${digest([scope.authority.run_ref, scope.authority.interval, requestId, sourceText]).slice(0, 20)}`,
      player_attempt: resolvedPlayer.attempt,
      coworker_attempts: resolvedCoworkers
    }
  };
}

async function interpretPlayerLanguage({ run, player_text, interpreter, request_id = null }) {
  const sourceText = typeof player_text === "string" ? player_text.slice(0, 4000) : "";
  const requestId = safeRequestId(request_id, sourceText);
  const source = sourceName(interpreter);
  if (typeof player_text !== "string" || !player_text.trim()) return malformed(sourceText, requestId, source, "PLAYER_LANGUAGE_REQUIRED");
  if (player_text.length > 4000) return malformed(sourceText, requestId, source, "PLAYER_LANGUAGE_TOO_LONG");
  if (typeof interpreter?.interpret !== "function") return malformed(sourceText, requestId, source, "INTERPRETER_UNAVAILABLE");
  let scope;
  try { scope = buildCustodianScope(run); }
  catch { return malformed(sourceText, requestId, source, "OBSERVER_PROJECTION_UNAVAILABLE"); }
  let proposal;
  try { proposal = await interpreter.interpret({ player_text: player_text, context: deepFreeze(structuredClone(scope.context)) }); }
  catch { return malformed(sourceText, requestId, source, "INTERPRETER_FAILED"); }
  const resolved = validateAndResolve(proposal, scope, { sourceText, requestId, source });
  if (resolved.kind === "clarification") return resolved;
  const candidate = deepFreeze({
    version: RESULT_VERSION,
    kind: "candidate",
    noncanonical: true,
    source_text: sourceText,
    request_id: requestId,
    sink: resolved,
    validation: {
      scope_digest: scope.digest,
      observer_context_version: CONTEXT_VERSION,
      player_commitments: "explicit-language-only",
      canonical_state: "unmodified"
    },
    provenance: { source, proposal_version: PROPOSAL_VERSION }
  });
  issuedCandidates.add(candidate);
  return candidate;
}

function dispatchCandidate(run, candidate) {
  if (!issuedCandidates.has(candidate) || candidate?.version !== RESULT_VERSION || candidate?.kind !== "candidate") {
    return { ok: false, outcome: "rejected", error: { code: "UNVALIDATED_INTERPRETATION" }, result: { public_reason: "Only a validated interpreter candidate can be submitted to Custodian." }, run };
  }
  let current;
  try { current = buildCustodianScope(run); }
  catch { return { ok: false, outcome: "rejected", error: { code: "OBSERVER_PROJECTION_UNAVAILABLE" }, result: { public_reason: "The current observer-safe action context is unavailable." }, run }; }
  if (current.digest !== candidate.validation.scope_digest) {
    return { ok: false, outcome: "rejected", error: { code: "STALE_INTERPRETATION" }, result: { public_reason: "The world changed after interpretation; interpret the player's language again." }, run };
  }
  if (candidate.sink.kind === SINGLE_SINK) {
    return bootstrap.act(run, candidate.sink.payload.action, candidate.sink.payload.target);
  }
  if (candidate.sink.kind === COORDINATED_SINK) {
    return bootstrap.resolveCoordinatedAttempts(run, structuredClone(candidate.sink.payload));
  }
  return { ok: false, outcome: "rejected", error: { code: "INTERPRETATION_SINK_UNAVAILABLE" }, result: { public_reason: "The validated candidate does not target an available Custodian sink." }, run };
}

module.exports = {
  PROPOSAL_VERSION,
  CONTEXT_VERSION,
  RESULT_VERSION,
  SINGLE_SINK,
  COORDINATED_SINK,
  buildCustodianScope,
  interpretPlayerLanguage,
  dispatchCandidate
};
