"use strict";

// Canonical actor knowledge: WHAT an actor may know, composed deterministically from canonical sources,
// each fact carrying its provenance. This module is a pure projection of persisted canonical state (the
// delivered briefing lines and who heard them, the roster, equipment, heard dialogue and the plans that
// authorized it, the actor's own observations, the owner-ratified Day-1 baseline). Nothing here is stored
// separately, nothing is inferred from a role title, and nothing comes from a language model. Knowing a
// fact is NOT permission to say it: the response plan decides what a turn may communicate.
//
//   PROJECT TRUTH  !=  WHAT THIS CHARACTER KNOWS  !=  WHAT THIS CHARACTER MAY SAY ON THIS TURN
//
// Knowledge sources (provenance):
//   baseline_induction        owner-ratified orientation every CQ4 Day-1 expedition member holds before the
//                             briefing (ASYNC, the Complex, the Threshold, Standard, LOCAL/STANDARD, Maxwell)
//   baseline_field_procedure  owner-ratified basic field training, only where project canon defines it
//   briefing                  a delivered Maxwell briefing line the actor was present for
//   self                      the actor's own name, role, assignment, held equipment
//   observed                  the actor's own canonical observations (attended events, custody seen)
//   heard                     what another person said in the actor's hearing, from the plan that
//                             AUTHORIZED the line (never re-parsed wording); report form, never first-hand
//   recorded                  institutional records explicitly granted to the actor
//   remembered                an earlier observation that is no longer current (historical questions only)

const canonLexicon = require("./canon-lexicon");
const openerDefinition = require("../data/worldpacks/clear-q4/cq4-day1-opener.json");

const KNOWLEDGE_VERSION = "yellow-beast-canonical-knowledge@v2";
const PROVENANCE = Object.freeze({ BASELINE_INDUCTION: "baseline_induction", BASELINE_FIELD_PROCEDURE: "baseline_field_procedure", SELF: "self", BRIEFING: "briefing", INSTITUTIONAL: "institutional", OBSERVED: "observed", HEARD: "heard", RECORDED: "recorded", REMEMBERED: "remembered" });
// Semantic concepts a response plan may query. Each is a KIND of question, never an answer phrase.
const CONCEPTS = Object.freeze(["institution_purpose", "mission_objective", "current_procedure", "schedule", "person_identity", "person_role", "person_authority", "person_relation", "role_or_assignment", "assignment_purpose", "entity_definition", "entity_state", "field_procedure", "location_purpose", "current_action", "reported_speech", "custody", "briefing_instruction", "person_presence"]);

// Why a question could not be answered in full (developer trace; never shown in player UI). A character
// says "I don't know" only for reasons that are real character ignorance.
const SEMANTIC_REASON = Object.freeze({
  INTERPRETATION_FAILURE: "interpretation_failure",
  KNOWLEDGE_PROJECTION_FAILURE: "knowledge_projection_failure",
  MISSING_STRUCTURED_CANON: "missing_structured_canon",
  LEGITIMATE_UNKNOWN: "legitimate_unknown",
  PARTIAL_KNOWLEDGE: "partial_knowledge",
  REFERENCE_AMBIGUITY: "reference_ambiguity",
  ADVISORY_UNAVAILABLE: "advisory_unavailable"
});
// Reasons that support in-world ignorance ("I don't know" / "nobody's told me").
const CHARACTER_IGNORANCE = new Set([SEMANTIC_REASON.LEGITIMATE_UNKNOWN, SEMANTIC_REASON.MISSING_STRUCTURED_CANON, SEMANTIC_REASON.PARTIAL_KNOWLEDGE]);

const idOf = (member) => member?.personnel_id ?? member?.id ?? null;
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const sentence = (text) => clean(text).replace(/[.!?\s]+$/, "");
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─── canonical entity index (reference does not require presence; knowledge does) ───────────────
// Lexical aliases name a canonical entity/task; they are language, never facts. The player's synonyms are
// understood here; NPC wording keeps the canonical terms (see dialogue-validation).
const TASK_ALIASES = Object.freeze({
  "verbal-recall": ["observation and verbal recall", "verbal recall", "verbal record", "recall", "recording", "record", "observations", "observation", "notes"],
  "material-delivery": ["startup materials", "startup material", "startup prerequisite materials", "materials", "material", "delivery", "delivering", "duffle", "duffel", "the bag", "cargo"],
  "layout-compilation": ["layout record", "layout", "compiling", "the record"]
});
const TASK_ITEMS = Object.freeze({ "material-delivery": /duff(?:le|el)|startup/i, "layout-compilation": /layout/i, "verbal-recall": null });
const PLACE_ENTITIES = Object.freeze({
  // "backrooms" is a PLAYER synonym only (understood, never spoken by NPCs: see dialogue-validation).
  complex: { id: "complex", kind: "entity", label: "the Complex", names: ["the complex", "complex", "the backrooms", "backrooms"] },
  standard: { id: "standard", kind: "entity", label: "Standard", names: ["standard", "standard side", "standard comms", "standard channel", "standard communication", "standard communications"] },
  local: { id: "local", kind: "entity", label: "LOCAL", names: ["local", "local comms", "local channel", "local communication", "local communications"] },
  "outpost-a": { id: "outpost-a", kind: "location", label: "Outpost A", names: ["outpost a", "the outpost", "outpost", "bermuda branch", "bermuda"] },
  // Deictic "this place" is not a name (it may mean the facility or the Complex); only the institution's
  // names and company phrasings resolve here.
  async: { id: "async", kind: "institution", label: "ASYNC", names: ["async", "a-sync", "the company", "this company", "this outfit"] }
});
// Player synonyms for canonical entities (interpretation only).
const ENTITY_ALIASES = Object.freeze({ threshold: ["portal", "gateway", "the gate"] });
// Field procedures that project canon defines (the entity a baseline field-procedure grant is about).
const PROCEDURE_ENTITIES = Object.freeze({
  "procedure:crossing": { id: "procedure:crossing", kind: "procedure", label: "the crossing procedure", names: ["radio check", "radio-check", "check-in", "check in", "crossing procedure", "the crossing", "crossing over", "crossing"] },
  "procedure:return": { id: "procedure:return", kind: "procedure", label: "the return procedure", names: ["return procedure", "coming back", "getting back", "the return", "come back", "get back"] },
  "procedure:carry-limit": { id: "procedure:carry-limit", kind: "procedure", label: "the carry limit", names: ["carry limit", "carrying limit", "carry capacity", "carrying capacity", "how much we can carry", "how much can we carry", "how much can i carry", "how many items"] },
  "procedure:guidance-tape": { id: "procedure:guidance-tape", kind: "procedure", label: "the green guidance tape", names: ["green guidance tape", "guidance tape", "green tape", "neon tape", "neon-green tape", "the tape"] }
});
const EQUIPMENT_ALIASES = Object.freeze({ "battery-lamp": ["flashlight", "field light", "the light", "torch", "lamp"], "field-camera": ["camera", "35mm camera", "field camera"], "35mm-camera": ["camera", "35mm camera", "field camera"] });

const briefingAuthority = (run) => run?.expedition?.mission?.briefing_authority ?? openerDefinition.briefing_authority;
const maxwellIdOf = (run) => briefingAuthority(run)?.identity ?? "dr-kirk-maxwell";

/** Every canonical entity the actor's words could refer to, with its lexical names. */
function entityIndex(run) {
  const out = [];
  const add = (entry) => out.push({ ...entry, names: [...new Set(entry.names.map((n) => String(n).toLowerCase()).filter(Boolean))] });
  const playerId = run?.session?.startup?.player?.observer_id ?? null;
  const teamIds = new Set();
  for (const member of run?.expedition?.team?.members ?? []) {
    teamIds.add(idOf(member));
    add({ id: idOf(member), kind: "person", label: member.first_name ?? member.display_name, names: [member.first_name, member.last_name, member.display_name, ...(member.aliases ?? [])].filter(Boolean), is_player: idOf(member) === playerId, role: member.role ?? null });
  }
  const authority = run?.expedition?.day1_opener ? briefingAuthority(run) : null;
  if (authority) {
    teamIds.add(authority.identity ?? "dr-kirk-maxwell");
    add({ id: authority.identity ?? "dr-kirk-maxwell", kind: "person", label: authority.name, names: ["kirk", "maxwell", "dr. maxwell", "dr maxwell", "kirk maxwell", "dr. kirk maxwell", "doctor maxwell", "the doctor who briefed us", "the briefing doctor"], non_present: true, title: "Dr.", role: "doctor" });
  }
  // Other canonical people in the world (resolvable by name; knowledge about them still needs a grant).
  for (const person of Object.values(run?._world?.characters ?? {})) {
    const id = person?.identity ?? person?.id;
    if (!id || teamIds.has(id)) continue;
    add({ id, kind: "person", label: person.first_name ?? person.display_name ?? id, names: [person.first_name, person.last_name, person.display_name].filter((n) => n && String(n).length >= 3), non_present: true, role: person.role ?? null, world_only: true });
  }
  for (const location of Object.values(canonLexicon.CANONICAL_LOCATIONS ?? {})) add({ id: location.id, kind: "location", label: location.display_name, names: [location.display_name, location.display_name.replace(/^ASYNC\s+/i, ""), ...(location.id === "equipment-staging" ? ["staging"] : []), ...(location.id === "threshold-room" ? ["kv31"] : []), ...(location.id === "async-briefing-room" ? ["this room", "the briefing room", "briefing room"] : [])] });
  for (const entity of Object.values(canonLexicon.CANONICAL_ENTITIES ?? {})) add({ id: entity.id, kind: "entity", label: entity.display_name, names: [entity.bare_name, entity.display_name, ...(ENTITY_ALIASES[entity.id] ?? [])] });
  for (const place of Object.values(PLACE_ENTITIES)) add(place);
  for (const procedure of Object.values(PROCEDURE_ENTITIES)) add(procedure);
  for (const item of Object.values(run?.expedition?.equipment ?? {})) if (item?.id && item.label) add({ id: item.id, kind: "equipment", label: item.label, item_type: item.type ?? null, names: [item.label, item.type, String(item.label).split(/\s+/).at(-1), ...(EQUIPMENT_ALIASES[item.type] ?? [])].filter(Boolean) });
  for (const [task, names] of Object.entries(TASK_ALIASES)) add({ id: `task:${task}`, kind: "task", label: names[0], names });
  return out;
}

/**
 * Canonical entities named in a text, longest name first; ties broken by kind (a person before a task).
 * Returns [] when nothing canonical is named. An unknown name resolves to nothing: hidden or unknown
 * entities never appear.
 */
function resolveEntityMentions(text, index) {
  const raw = ` ${String(text ?? "").toLowerCase().replace(/[‘’]/g, "'")} `;
  const hits = [];
  for (const entry of index ?? []) {
    let best = null;
    for (const name of entry.names) {
      if (name.length < 3) continue;
      const match = raw.match(new RegExp(`[^a-z0-9]${escapeRe(name)}(?:'s)?[^a-z0-9]`));
      if (match && (!best || name.length > best.name.length)) best = { entry, name, at: match.index };
    }
    if (best) hits.push(best);
  }
  // A longer overlapping name wins ("equipment staging" over "staging"; "layout record" item over task).
  hits.sort((a, b) => b.name.length - a.name.length);
  const kept = [];
  for (const hit of hits) if (!kept.some((k) => k.at <= hit.at && hit.at + hit.name.length <= k.at + k.name.length + 1 && k.entry.id !== hit.entry.id && k.name.includes(hit.name))) kept.push(hit);
  return kept.sort((a, b) => a.at - b.at).map((hit) => ({ id: hit.entry.id, kind: hit.entry.kind, label: hit.entry.label, matched: hit.name, ...(hit.entry.non_present ? { non_present: true } : {}), ...(hit.entry.is_player ? { is_player: true } : {}), ...(hit.entry.world_only ? { world_only: true } : {}) }));
}

// ─── the delivered briefing (what was actually said, and to whom) ───────────────────────────────
// Every authored beat's spoken propositions (by grant key). A partial briefing grants only delivered beats.
const BRIEFING_BEAT_PROPOSITIONS = Object.freeze({
  intro: ["maxwell_address_form", "maxwell_gave_briefing"],
  mission_statement: ["mission_statement"],
  schedule: ["operational_window"],
  roster_call: ["briefed_assignment", "startup_material_destination", "outpost_destination"],
  dismissal: ["dismissal_instruction", "next_destination"]
});
function deliveredBriefing(run) {
  const briefing = run?.expedition?.day1_opener?.personnel_briefing ?? null;
  if (!briefing?.exchange_history?.length) return [];
  const dialogue = briefing.dialogue ?? {};
  const legacyListeners = (run.expedition.team?.members ?? []).map(idOf);
  const keyFor = (entry) => entry.beat_key
    ?? (entry.text === [dialogue.greeting, dialogue.intro].filter(Boolean).join(" ") ? "intro"
      : entry.text === dialogue.mission_statement ? "mission_statement"
        : /^Departure is scheduled/.test(entry.text ?? "") ? "schedule"
          : entry.text === dialogue.roster_call ? "roster_call"
            : entry.text === dialogue.dismissal ? "dismissal" : null);
  return briefing.exchange_history
    .filter((entry) => entry && /MAXWELL/i.test(String(entry.speaker ?? "")))
    .map((entry) => ({ key: keyFor(entry), text: clean(entry.text), listeners: Array.isArray(entry.listeners) ? entry.listeners : legacyListeners, at_interval: Number.isFinite(Number(entry.at_interval)) ? Number(entry.at_interval) : null }))
    .filter((beat) => beat.key);
}

/** The roster call's per-person assignments, parsed from the authored TEMPLATE (never from prose). */
function rosterAssignments(run) {
  const template = briefingAuthority(run)?.dialogue?.roster_call ?? "";
  const members = run?.expedition?.team?.members ?? [];
  const slotMember = { player_name: members[0], coworker1_name: members[1], coworker2_name: members[2], coworker3_name: members[3] };
  const out = [];
  for (const part of template.split(/(?<=\.)\s+/)) {
    const slot = part.match(/\{(\w+)\}/)?.[1];
    const member = slot ? slotMember[slot] : null;
    if (!member) continue;
    const phrase = sentence(part.replace(/\{\w+\}/, "").replace(/^[,\s]+/, "").replace(/^you're\s+/i, ""));
    out.push({ person_id: idOf(member), name: member.first_name ?? member.display_name, phrase, primary_task: member.primary_task ?? null });
  }
  return out;
}

// Authority classes (amendment "Canon authority layers"). A grant is only ever made from L1/L2 content
// delivered through a canonical event, from the actor's own record, or from the owner-ratified Day-1
// baseline; L3 reference material and L4 implementation labels never create a grant.
const AUTHORITY = Object.freeze({ L1: "L1_project_authority", OWNER: "L1_owner_ratified_day1_canon", L2: "L2_authored_current_slice", EVENT: "canonical_runtime_event" });
const WORLDPACK = "data/worldpacks/clear-q4/cq4-day1-opener.json";
const OWNER_RATIFICATION = "owner ratification 2026-09-25 (docs/dialogue/DAY1_KNOWLEDGE_MATRIX.md#canon-ratification)";

/**
 * One auditable knowledge grant: { concept, key, proposition, facet, authority_class, source_ref,
 * grant_basis, epistemic_mode, valid_scope, entity_id?, speaker_id?, reported?, activated_at? }.
 * `statement`/`provenance` mirror proposition/epistemic_mode for the planners. `reported` is the grant's
 * proposition as a clause another person could report ("the startup materials are going to Outpost A").
 * NO SOURCE -> NO GRANT: every call site names its source.
 */
function grant({ concept, key, proposition, facet = null, authority_class, source_ref, grant_basis, epistemic_mode, valid_scope, entity_id = null, speaker_id = null, reported = null, activated_at = null, commit_sensitive = false, extra = {} }) {
  return Object.freeze({ concept, key, proposition, statement: proposition, facet: facet ?? DEFAULT_FACET[concept] ?? null, authority_class, source_ref, grant_basis, epistemic_mode, provenance: epistemic_mode, valid_scope, commit_sensitive, ...(entity_id ? { entity_id } : {}), ...(speaker_id ? { speaker_id } : {}), ...(reported ? { reported } : {}), ...(activated_at != null ? { activated_at } : {}), ...extra });
}
// The facet a concept's question asks for by default (a question about what something is FOR asks its
// purpose, not its destination). A grant carries the facet it actually establishes.
const DEFAULT_FACET = Object.freeze({ briefing_instruction: "instruction", person_presence: "current_presence", custody: "current_holder", institution_purpose: "purpose", mission_objective: "objective", current_procedure: "next_step", schedule: "schedule", person_identity: "identity", person_role: "role", person_authority: "authority", person_relation: "acquaintance", role_or_assignment: "assignment", assignment_purpose: "purpose", entity_definition: "definition", entity_state: "current_state", field_procedure: "procedure", location_purpose: "purpose", current_action: "activity" });

/** Is this actor a member of the current CQ4 Day-1 expedition (the owner-ratified baseline's scope)? */
function isDay1ExpeditionMember(run, actorId) {
  if (!run?.expedition?.day1_opener || !actorId) return false;
  return (run.expedition.team?.members ?? []).some((m) => idOf(m) === actorId);
}
const itemOfType = (run, types) => Object.values(run?.expedition?.equipment ?? {}).find((item) => item && types.includes(item.type)) ?? null;

/**
 * BASELINE INDUCTION + BASELINE FIELD PROCEDURE (owner-ratified 2026-09-25): narrow operational
 * orientation every current Day-1 expedition member holds BEFORE the briefing. Only definitions and
 * procedural form: no science, engineering, history, anomaly knowledge, biographies, relationships,
 * mission specifics or current state. Field procedures are granted only where project canon defines them.
 */
function baselineKnowledge(run, actorId) {
  if (!isDay1ExpeditionMember(run, actorId)) return [];
  const maxwellId = maxwellIdOf(run);
  const base = (extra) => grant({ authority_class: AUTHORITY.OWNER, grant_basis: "assigned to the current expedition (baseline induction)", epistemic_mode: PROVENANCE.BASELINE_INDUCTION, valid_scope: "from assignment (before the briefing)", ...extra });
  const field = (extra) => grant({ authority_class: AUTHORITY.OWNER, grant_basis: "basic field training for expedition duty (baseline field procedure)", epistemic_mode: PROVENANCE.BASELINE_FIELD_PROCEDURE, valid_scope: "from assignment (procedural form only; no mission specifics)", ...extra });
  const out = [
    // ASYNC: the one employee-facing institutional sentence the owner authorized. Nothing beyond it.
    base({ concept: "institution_purpose", key: "async_purpose", proposition: "ASYNC organizes and supports controlled research, documentation, logistics and expedition operations related to the Complex.", reported: "ASYNC organizes and supports controlled research, documentation, logistics and expedition operations related to the Complex", source_ref: `${OWNER_RATIFICATION} §4`, entity_id: "async", extra: { bounded_unknown: "anything beyond that (its history, structure or programs)" } }),
    base({ concept: "institution_purpose", key: "async_employer", facet: "employer", proposition: "We work for ASYNC; they assigned us to this expedition.", reported: "ASYNC assigned us to this expedition", source_ref: `${OWNER_RATIFICATION} §2`, entity_id: "async" }),
    // Ontology DEFINITIONS only; never current state (whether the Threshold is energized, who is there).
    base({ concept: "entity_definition", key: "complex_definition", proposition: "The Complex is the environment our expedition operates in.", reported: "the Complex is the environment the expedition operates in", source_ref: `${OWNER_RATIFICATION} §2`, entity_id: "complex", extra: { bounded_unknown: "why it exists or how it is laid out" } }),
    base({ concept: "entity_definition", key: "threshold_definition", proposition: "The Threshold is the fixed crossing between Standard and the Complex. It's part of the facility, not equipment anyone carries.", reported: "the Threshold is the fixed crossing between Standard and the Complex", source_ref: `${OWNER_RATIFICATION} §2; canon-lexicon CANONICAL_ENTITIES.threshold (fixed_transition, not portable)`, entity_id: "threshold" }),
    base({ concept: "entity_definition", key: "standard_definition", proposition: "Standard is the ASYNC side of the crossing, the ordinary world.", reported: "Standard is the ASYNC side of the crossing", source_ref: `${OWNER_RATIFICATION} §2; Gameplay Constitution §6 STANDARD`, entity_id: "standard" }),
    base({ concept: "entity_definition", key: "standard_comms_definition", facet: "definition", proposition: "STANDARD communication is the A-Sync link between Standard and the team in the Complex.", reported: "STANDARD communication is the A-Sync link between Standard and the team in the Complex", source_ref: `${OWNER_RATIFICATION} §2; Gameplay Constitution §6 STANDARD`, entity_id: "standard" }),
    base({ concept: "entity_definition", key: "local_definition", proposition: "LOCAL is talking with the team in person, where we are.", reported: "LOCAL is talking with the team in person", source_ref: `${OWNER_RATIFICATION} §2; Gameplay Constitution §6 LOCAL`, entity_id: "local" }),
    base({ concept: "mission_objective", key: "expedition_assignment", facet: "assignment_kind", proposition: "We're assigned to an expedition into the Complex.", reported: "we're assigned to an expedition into the Complex", source_ref: `${OWNER_RATIFICATION} §2` }),
    // Maxwell: identity and briefing authority only. No friendship, shared history, rank or specialty.
    base({ concept: "person_identity", key: "maxwell_identity", proposition: "That's Dr. Kirk Maxwell.", reported: "that's Dr. Kirk Maxwell", source_ref: `${OWNER_RATIFICATION} §5`, entity_id: maxwellId, extra: { bounded_unknown: "anything about him beyond the briefing" } }),
    base({ concept: "person_role", key: "maxwell_role", proposition: "He's the Standard-side authority responsible for our assignment briefing.", reported: "Maxwell is the Standard-side authority responsible for the assignment briefing", source_ref: `${OWNER_RATIFICATION} §5`, entity_id: maxwellId }),
    base({ concept: "person_authority", key: "maxwell_authority", proposition: "He's the Standard-side authority responsible for our assignment briefing.", reported: "Maxwell is the Standard-side authority responsible for the assignment briefing", source_ref: `${OWNER_RATIFICATION} §5`, entity_id: maxwellId })
  ];
  // Field procedure: basic procedural FORM, only where canon defines it (today's route, holder,
  // destination and timing stay mission knowledge).
  out.push(field({ concept: "field_procedure", key: "crossing_radio_check", proposition: "Right after crossing the Threshold you make a radio check with Standard, and the check has to be held at least two seconds before the crossing counts.", reported: "right after crossing you make a radio check with Standard, held at least two seconds", source_ref: `${OWNER_RATIFICATION} §3; tools/q4-experience.js nextPhase (opener: CROSS -> STANDARD_RADIO_CHECK); desktop/service.js completeQ4CheckInHold (>= 2000 ms)`, entity_id: "procedure:crossing" }));
  out.push(field({ concept: "field_procedure", key: "return_procedure", proposition: "Coming back, you return to the Threshold, verify the return with Control Room surveillance, and cross back to Standard.", reported: "coming back, you return to the Threshold, verify with Control Room surveillance and cross back to Standard", source_ref: `${OWNER_RATIFICATION} §3; ${WORLDPACK}#mission.procedures[5] (timing excluded)`, entity_id: "procedure:return" }));
  const capacity = (run.expedition.mission?.assigned_manifest ?? openerDefinition.assigned_manifest)?.hard_capacity_per_person;
  if (Number.isFinite(Number(capacity))) out.push(field({ concept: "field_procedure", key: "carry_capacity", proposition: `Each of us can carry at most ${Number(capacity) === 2 ? "two" : capacity} issued items.`, reported: `each person carries at most ${Number(capacity) === 2 ? "two" : capacity} issued items`, source_ref: `${OWNER_RATIFICATION} §3; ${WORLDPACK}#assigned_manifest.hard_capacity_per_person; tools/logistics-runtime.js (item count)`, entity_id: "procedure:carry-limit" }));
  const guidance = run.expedition.mission?.guidance ?? openerDefinition.guidance;
  if (guidance?.type === "physical-object") out.push(field({ concept: "field_procedure", key: "guidance_tape", proposition: "You follow the neon-green guidance tape; its arrows point the way forward, and the reverse arrows lead back.", reported: "you follow the green guidance tape; the reverse arrows lead back", source_ref: `${OWNER_RATIFICATION} §3; ${WORLDPACK}#guidance (form only; today's direction is mission knowledge)`, entity_id: "procedure:guidance-tape" }));
  const camera = itemOfType(run, ["field-camera", "35mm-camera"]);
  if (camera) out.push(field({ concept: "assignment_purpose", key: "camera_purpose", proposition: "The 35mm field camera is for photographic documentation.", reported: "the 35mm field camera is for photographic documentation", source_ref: `${OWNER_RATIFICATION} §3; tools/q4-equipment.js DEFINITIONS["field-camera"].capability`, entity_id: camera.id }));
  const light = itemOfType(run, ["battery-lamp"]);
  if (light) out.push(field({ concept: "assignment_purpose", key: "field_light_purpose", proposition: "The field light is for illumination.", reported: "the field light is for illumination", source_ref: `${OWNER_RATIFICATION} §3; tools/q4-equipment.js DEFINITIONS["field-light"].capability`, entity_id: light.id }));
  // Assignment categories, minimal semantic purpose only (owner §7; supported by mission.reporting.evidence
  // "Record manifestation layout and condition observations" and the layout-record item's capability).
  out.push(field({ concept: "assignment_purpose", key: "verbal_recall_purpose", proposition: "Observation and verbal recall is recording and preserving the expedition's field observations and verbal recall.", reported: "observation and verbal recall is recording and preserving the expedition's field observations", source_ref: `${OWNER_RATIFICATION} §7; ${WORLDPACK}#briefing_authority.dialogue.roster_call; tools/cq4-day1-opener.js mission().reporting.evidence`, entity_id: "task:verbal-recall" }));
  out.push(field({ concept: "assignment_purpose", key: "layout_record_purpose", proposition: "The layout record is the expedition's record of the layout we observe and explore.", reported: "the layout record is the expedition's record of the observed layout", source_ref: `${OWNER_RATIFICATION} §7; ${WORLDPACK}#staffing (layout-record: layout documentation); mission().reporting.evidence`, entity_id: "task:layout-compilation" }));
  return out;
}

/**
 * Items whose custody a briefing line this actor heard actually stated: the roster call names the
 * assignment, and the authored manifest (same worldpack) says which issued item that assignment is.
 * Unbriefed issuance (e.g. who carries the field light) is not granted.
 */
function briefedCustody(run, actorId) {
  const heardRoster = deliveredBriefing(run).some((beat) => beat.key === "roster_call" && beat.listeners.includes(actorId));
  if (!heardRoster) return new Map();
  const manifest = (run?.expedition?.mission?.assigned_manifest ?? openerDefinition.assigned_manifest)?.default_assignments ?? {};
  const members = run?.expedition?.team?.members ?? [];
  const slotOf = { player_name: "player", coworker1_name: "coworker1", coworker2_name: "coworker2", coworker3_name: "coworker3" };
  const template = briefingAuthority(run)?.dialogue?.roster_call ?? "";
  const out = new Map();
  for (const part of template.split(/(?<=\.)\s+/)) {
    const slot = part.match(/\{(\w+)\}/)?.[1];
    const member = { player_name: members[0], coworker1_name: members[1], coworker2_name: members[2], coworker3_name: members[3] }[slot];
    if (!member) continue;
    const words = (part.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["custody", "scheduled", "branch", "outpost", "bermuda", "you're", "observation"].includes(w));
    for (const type of manifest[slotOf[slot]] ?? []) {
      const item = run?.expedition?.equipment?.[type] ?? Object.values(run?.expedition?.equipment ?? {}).find((i) => i?.type === type || i?.id === type);
      const label = String(item?.label ?? type).toLowerCase();
      if (item && words.some((w) => label.includes(w.replace(/s$/, "")))) out.set(item.id, { holder_id: idOf(member), source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call + assigned_manifest.default_assignments.${slotOf[slot]}` });
    }
  }
  return out;
}

/**
 * Every grant this actor holds, composed from canonical state only; bounded. Knowledge is not permission
 * to say anything: the response plan decides what a turn communicates.
 */
function knowledgeFor(run, actorId) {
  const facts = [];
  if (!run?.expedition || !actorId) return facts;
  const members = run.expedition.team?.members ?? [];
  const self = members.find((m) => idOf(m) === actorId) ?? null;

  // BASELINE: owner-ratified orientation and field procedure (before any briefing line).
  facts.push(...baselineKnowledge(run, actorId));

  // SELF: the actor's own canonical record (role from the authored staffing archetype; held equipment).
  if (self) {
    if (self.role) facts.push(grant({ concept: "role_or_assignment", key: "own_role", facet: "role", proposition: `I'm ${/^[aeiou]/i.test(self.role) ? "an" : "a"} ${self.role}.`, authority_class: AUTHORITY.L2, source_ref: `${WORLDPACK}#staffing.coworker_archetypes[].role -> team.member.role`, grant_basis: "own personnel record", epistemic_mode: PROVENANCE.SELF, valid_scope: "run", entity_id: actorId }));
    for (const item of Object.values(run.expedition.equipment ?? {}).filter((i) => i.holder === actorId)) facts.push(grant({ concept: "assignment_purpose", key: "own_equipment", facet: "custody", proposition: `I'm carrying the ${String(item.label).toLowerCase()}.`, authority_class: AUTHORITY.EVENT, source_ref: `equipment.${item.id}.holder`, grant_basis: "own custody", epistemic_mode: PROVENANCE.SELF, valid_scope: "while held", entity_id: item.id, commit_sensitive: true }));
  }

  facts.push(...briefingKnowledge(run, actorId));

  // OBSERVED custody: what the actor saw. Commit-sensitive -- still true now it is an observation; once
  // custody has changed it is only REMEMBERED (a historical snapshot), never current knowledge.
  const seen = new Map();
  for (const entry of self?.known_information ?? []) if (entry?.kind === "custody-observed" && entry.equipment_id) seen.set(entry.equipment_id, entry);
  for (const [itemId, entry] of seen) {
    const item = Object.values(run.expedition.equipment ?? {}).find((i) => i?.id === itemId) ?? run.expedition.equipment?.[itemId] ?? null;
    if (!item) continue;
    const current = item.holder === entry.holder_id;
    const holderName = entry.holder_id === actorId ? "me" : (entry.holder_id === run.session?.startup?.player?.observer_id ? "you" : members.find((m) => idOf(m) === entry.holder_id)?.first_name ?? "someone");
    facts.push(grant({ concept: "custody", key: current ? "observed_custody" : "remembered_custody", facet: current ? "current_holder" : "earlier_holder", proposition: current ? `I saw the ${String(item.label).toLowerCase()} with ${holderName}.` : `Earlier I saw the ${String(item.label).toLowerCase()} with ${holderName}.`, reported: `the ${String(item.label).toLowerCase()} was with ${holderName}`, authority_class: AUTHORITY.EVENT, source_ref: `known_information.custody-observed@${entry.at}`, grant_basis: "saw the custody", epistemic_mode: current ? PROVENANCE.OBSERVED : PROVENANCE.REMEMBERED, valid_scope: current ? "while custody is unchanged" : "historical only", entity_id: item.id, activated_at: entry.at ?? null, commit_sensitive: true }));
  }

  // WHERE WE ARE (current state, observed): which side of the crossing the actor is on, from their own
  // canonical location. Never from the definition of Standard.
  const here = run.spatial?.personnel_locations?.[actorId] ?? null;
  const herePhase = here ? canonLexicon.CANONICAL_LOCATIONS[here]?.phase ?? null : null;
  if (isDay1ExpeditionMember(run, actorId) && ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD"].includes(herePhase)) facts.push(grant({ concept: "entity_state", key: "on_standard_side", facet: "current_state", proposition: "We're still on the Standard side; we haven't crossed.", reported: "the team is still on the Standard side", authority_class: AUTHORITY.EVENT, source_ref: `spatial.personnel_locations (${here})`, grant_basis: "where the actor is standing", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "while on the Standard side", entity_id: "standard", commit_sensitive: true }));
  // Present coworkers are perceived as present (current state only).
  for (const member of members) {
    const id = idOf(member);
    if (id === actorId && here) { facts.push(grant({ concept: "person_presence", key: "self_present", facet: "current_presence", proposition: "I'm right here.", reported: "they're here", authority_class: AUTHORITY.EVENT, source_ref: `spatial.personnel_locations (${here})`, grant_basis: "own position", epistemic_mode: PROVENANCE.SELF, valid_scope: "while here", entity_id: id, commit_sensitive: true })); continue; }
    if (!here || run.spatial?.personnel_locations?.[id] !== here) continue;
    facts.push(grant({ concept: "person_presence", key: "present_here", facet: "current_presence", proposition: `${member.first_name ?? "They"}'s right here.`, reported: `${member.first_name ?? "they"} is here`, authority_class: AUTHORITY.EVENT, source_ref: `spatial.personnel_locations (${here})`, grant_basis: "can see them", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "while co-located", entity_id: id, commit_sensitive: true }));
  }

  // CURRENT PROCEDURE after the briefing room: derived from canonical state each time it is asked.
  facts.push(...procedureState(run, actorId));

  // HEARD: propositions other people's authorized lines communicated in the actor's hearing (report form).
  // A report of something the actor already holds is not a second truth record: it becomes an extra
  // provenance SUPPORT on the actor's own grant ("How do you know?" can choose the fitting one).
  const supports = new Map();
  const ownByKey = new Map(facts.map((f, i) => [f.key, i]));
  const ownByReported = new Map(facts.filter((f) => f.reported).map((f, i) => [f.reported, facts.indexOf(f)]));
  const heardSeen = new Set();
  for (const report of heardPropositions(run, actorId)) {
    if (report.epistemic_mode === PROVENANCE.HEARD) {
      const own = ownByKey.get(report.key) ?? ownByReported.get(report.reported);
      if (own != null) { const list = supports.get(own) ?? []; if (!list.some((x) => x.speaker_id === report.speaker_id)) list.push({ epistemic_mode: PROVENANCE.HEARD, speaker_id: report.speaker_id, speaker_name: report.speaker_name, source_ref: report.source_ref }); supports.set(own, list); continue; }
      // The same report heard again from the same speaker is one record.
      const dup = `${report.speaker_id}|${report.key}|${report.reported}`;
      if (heardSeen.has(dup)) continue;
      heardSeen.add(dup);
    }
    // Someone else's reported ignorance ("nobody told them") is reported speech, not knowledge about the subject.
    if (report.epistemic_mode !== PROVENANCE.HEARD || !report.concept || report.concept === "custody" || report.facet === "gap") continue;
    facts.push(grant({ concept: report.concept, key: `heard_${report.key}`, facet: report.facet ?? null, proposition: `${report.speaker_name} said ${report.reported}.`, reported: report.reported, authority_class: AUTHORITY.EVENT, source_ref: report.source_ref, grant_basis: `heard ${report.speaker_name} say it${report.origin ? ` (reporting ${report.origin})` : ""}`, epistemic_mode: PROVENANCE.HEARD, valid_scope: "after that line", entity_id: report.entity_ids[0] ?? null, speaker_id: report.speaker_id, activated_at: report.at, extra: report.origin ? { reported_origin: report.origin } : {} }));
  }
  for (const [index, list] of supports) facts[index] = Object.freeze({ ...facts[index], supports: list });
  return facts;
}

/**
 * BRIEFING grants: only lines of the ratified Maxwell briefing (L2) that were delivered while this actor
 * was present (personnel_briefing.exchange_history + listeners). UI-only text (his displayed title, the
 * room card) is never a grant. Each beat's spoken propositions are listed in BRIEFING_BEAT_PROPOSITIONS.
 */
function briefingKnowledge(run, actorId) {
  const facts = [];
  const members = run.expedition.team?.members ?? [];
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const nameOf = (id) => (id === actorId ? "me" : id === playerId ? "you" : members.find((m) => idOf(m) === id)?.first_name ?? null);
  const beats = deliveredBriefing(run).filter((beat) => beat.listeners.includes(actorId));
  const authority = briefingAuthority(run);
  const maxwellId = maxwellIdOf(run);
  const windowDef = run.expedition.mission?.operational_window ?? openerDefinition.operational_window ?? {};
  const heard = (beat, extra) => ({ authority_class: AUTHORITY.L2, grant_basis: `present for the delivered briefing line (${beat.key})`, epistemic_mode: PROVENANCE.BRIEFING, valid_scope: `after briefing.${beat.key} delivered`, speaker_id: maxwellId, activated_at: beat.at_interval, ...extra });
  const opener = run.expedition.day1_opener ?? null;
  for (const beat of beats) {
    if (beat.key === "intro") {
      facts.push(grant({ concept: "person_identity", key: "maxwell_address_form", facet: "address_form", proposition: "He said we can call him Kirk.", reported: "we can call him Kirk", source_ref: `${WORLDPACK}#briefing_authority.dialogue.intro`, entity_id: maxwellId, ...heard(beat) }));
      // Attending is an observation of an event; his title/authority was never stated aloud (UI only).
      facts.push(grant({ concept: "person_role", key: "maxwell_gave_briefing", facet: "role", proposition: "He gave us this morning's assignment briefing.", reported: "Maxwell gave the assignment briefing", authority_class: AUTHORITY.EVENT, source_ref: "personnel_briefing.exchange_history (attended)", grant_basis: "attended the briefing he delivered", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "after briefing.intro delivered", entity_id: maxwellId, activated_at: beat.at_interval }));
      // Where the briefing happened: the room's purpose as the actor saw it used (not facility lore).
      facts.push(grant({ concept: "location_purpose", key: "briefing_room_observed", proposition: "This is where Maxwell gave us our assignment briefing.", reported: "that room is where Maxwell gave the assignment briefing", authority_class: AUTHORITY.EVENT, source_ref: "personnel_briefing.room_id (attended)", grant_basis: "attended the briefing in this room", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "after briefing.intro delivered", entity_id: opener?.personnel_briefing?.room_id ?? "async-briefing-room", activated_at: beat.at_interval }));
    } else if (beat.key === "mission_statement") {
      const said = sentence(beat.text).replace(/^Today's assignment is straightforward\.\s*/i, "").toLowerCase();
      facts.push(grant({ concept: "mission_objective", key: "mission_statement", proposition: `Maxwell said today's assignment is ${said}.`, reported: `today's assignment is ${said}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.mission_statement`, ...heard(beat) }));
    } else if (beat.key === "schedule") {
      // The spoken schedule line is runtime-authored (L4 text); its values are the authored window (L2).
      facts.push(grant({ concept: "schedule", key: "operational_window", proposition: `Departure is at ${windowDef.deployment_time}, we're expected back by ${windowDef.expected_return_time}, and the cutoff is ${windowDef.cutoff_time}.`, reported: `departure is at ${windowDef.deployment_time}, return by ${windowDef.expected_return_time}, cutoff ${windowDef.cutoff_time}`, source_ref: `${WORLDPACK}#operational_window (spoken by the delivered schedule beat)`, ...heard(beat) }));
    } else if (beat.key === "roster_call") {
      for (const entry of rosterAssignments(run)) {
        const who = nameOf(entry.person_id);
        // The roster phrase as said: "has custody of ...", "on camera", "layout record".
        const predicate = (subject, be) => (/^has\b/.test(entry.phrase) ? `${subject} ${["I", "you"].includes(subject) ? entry.phrase.replace(/^has\b/, "have") : entry.phrase}` : `${subject} ${be} ${/^on\b/.test(entry.phrase) ? entry.phrase : `on ${entry.phrase}`}`);
        const said = entry.person_id === actorId ? `Maxwell said ${predicate("I", "am")}.` : who === "you" ? `Maxwell said ${predicate("you", "are")}.` : `Maxwell said ${predicate(entry.name, "is")}.`;
        facts.push(grant({ concept: "role_or_assignment", key: "briefed_assignment", proposition: said, reported: predicate(entry.person_id === playerId ? "you" : entry.name, entry.person_id === playerId ? "are" : "is"), source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: entry.person_id, ...heard(beat, { extra: entry.primary_task ? { task: `task:${entry.primary_task}` } : {} }) }));
        const outpost = entry.phrase.match(/scheduled for (.+)$/i)?.[1] ?? null;
        if (outpost) {
          // Startup materials (owner §6): mission cargo assigned for DELIVERY to the destination the
          // briefing names. Destination is not purpose; contents and deeper purpose stay unknown.
          facts.push(grant({ concept: "assignment_purpose", key: "startup_material_destination", facet: "destination", proposition: `The startup materials are cargo we're delivering to ${outpost}.`, reported: `the startup materials are going to ${outpost}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call; ${OWNER_RATIFICATION} §6`, entity_id: "task:material-delivery", ...heard(beat, { extra: { missing_facets: ["purpose", "contents"] } }) }));
          facts.push(grant({ concept: "assignment_purpose", key: "startup_material_custody", facet: "custody", proposition: entry.person_id === actorId ? "I'm the one delivering them." : `${entry.person_id === playerId ? "You're" : `${entry.name}'s`} the one delivering them.`, reported: `${entry.person_id === playerId ? "you are" : `${entry.name} is`} delivering the startup materials`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: "task:material-delivery", ...heard(beat) }));
          facts.push(grant({ concept: "entity_definition", key: "outpost_destination", facet: "destination", proposition: `All I know is the startup materials are going to ${outpost}.`, reported: `the startup materials are going to ${outpost}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: "outpost-a", ...heard(beat) }));
        }
      }
    } else if (beat.key === "dismissal") {
      const destination = sentence(beat.text).match(/report to ([A-Z][\w ]+?)(?: when|$)/)?.[1] ?? null;
      // Current procedure is commit-sensitive: it holds only while introductions are open (the canonical
      // handoff state), never as an eternal "next".
      const current = opener?.beat === "LOCAL_INTRODUCTIONS" && opener?.personnel_briefing?.status === "concluded" && (opener?.esd_handoff?.status ?? "introductions-open") === "introductions-open";
      // ED-30 G2: once getting acquainted is complete (every coworker has spoken to the lead about
      // themselves, or the lead closed it), the next INCOMPLETE step is reporting to the destination. The
      // instruction itself stays queryable as history (dismissal_instruction below).
      const acquainted = run.expedition.dialogue_state?.acquaintance?.complete_at != null;
      if (destination && current && acquainted) {
        facts.push(grant({ concept: "current_procedure", key: "report_to_next_destination", proposition: `Next we report to ${destination}.`, reported: `next we report to ${destination}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal + dialogue_state.acquaintance.complete_at`, commit_sensitive: true, extra: { next_step: `report to ${destination}`, current_step: null }, ...heard(beat) }));
      }
      if (destination && current && !acquainted) {
        facts.push(grant({ concept: "current_procedure", key: "briefing_dismissal", proposition: `We're to get acquainted, then report to ${destination}.`, reported: `we're to get acquainted, then report to ${destination}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, commit_sensitive: true, extra: { next_step: `report to ${destination}`, current_step: "get acquainted with the team" }, ...heard(beat) }));
        facts.push(grant({ concept: "current_action", key: "getting_acquainted", facet: "activity", proposition: "Just getting acquainted, like Maxwell said.", reported: "getting acquainted", source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, commit_sensitive: true, ...heard(beat) }));
      }
      // What Maxwell SAID to do (history): kept after the procedure moves on, for "What did Maxwell tell us to
      // do after introductions?". Never used as the CURRENT procedure.
      if (destination) facts.push(grant({ concept: "briefing_instruction", key: "dismissal_instruction", facet: "instruction", proposition: `Maxwell told us to get acquainted, then report to ${destination}.`, reported: `we were to get acquainted, then report to ${destination}`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, ...heard(beat) }));
      // Maxwell's presence: he delivered the dismissal and left (the canonical conclusion event).
      if (opener?.personnel_briefing?.status === "concluded") {
        facts.push(grant({ concept: "person_presence", key: "maxwell_departed", facet: "recent_presence", proposition: "He gave the briefing and then left.", reported: "Maxwell gave the briefing and then left", authority_class: AUTHORITY.EVENT, source_ref: "day1_opener.personnel_briefing.concluded_at_interval", grant_basis: "saw him leave after the briefing", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "after the briefing concluded", entity_id: maxwellId, activated_at: opener.personnel_briefing.concluded_at_interval ?? null }));
        facts.push(grant({ concept: "person_presence", key: "maxwell_not_present", facet: "current_presence", proposition: "He's not here now; he left after the briefing.", reported: "Maxwell is not here now", authority_class: AUTHORITY.EVENT, source_ref: "day1_opener.personnel_briefing.status = concluded", grant_basis: "he left the room", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "while he is away", entity_id: maxwellId, commit_sensitive: true }));
      }
      const staging = destination ? Object.values(canonLexicon.CANONICAL_LOCATIONS).find((l) => l.display_name === destination) : null;
      if (staging) facts.push(grant({ concept: "entity_definition", key: "next_destination", facet: "destination", proposition: `${destination} is where we report after this; that's all Maxwell said about it.`, reported: `we report to ${destination} after the briefing`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, entity_id: staging.id, ...heard(beat) }));
    }
  }

  return facts;
}

/**
 * The CURRENT procedure outside the briefing room, from canonical state only: staging (the team is at
 * equipment staging; nothing briefed says what follows) and the post-crossing radio check (baseline field
 * procedure). Recomputed on every query, so the answer changes when the canonical state does.
 */
function procedureState(run, actorId) {
  if (!isDay1ExpeditionMember(run, actorId)) return [];
  const opener = run.expedition.day1_opener;
  const out = [];
  const radio = run.expedition.radio ?? null;
  if (opener?.esd_handoff?.status === "equipment-cooperation" && !radio?.authorized) {
    out.push(grant({ concept: "current_procedure", key: "at_equipment_staging", proposition: "We're at Equipment Staging now.", reported: "we're at Equipment Staging", authority_class: AUTHORITY.EVENT, source_ref: "day1_opener.esd_handoff.status = equipment-cooperation", grant_basis: "present at staging", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "while at staging", commit_sensitive: true, extra: { current_step: "equipment staging", next_step: null } }));
  }
  if (radio?.authorized && !radio.check_completed) {
    out.push(grant({ concept: "current_procedure", key: "post_crossing_radio_check", proposition: "We've crossed; next is the radio check with Standard, held at least two seconds.", reported: "next is the radio check with Standard", authority_class: AUTHORITY.OWNER, source_ref: `radio.authorized && !radio.check_completed; ${OWNER_RATIFICATION} §3`, grant_basis: "basic field training applied to the current state", epistemic_mode: PROVENANCE.BASELINE_FIELD_PROCEDURE, valid_scope: "until the radio check completes", commit_sensitive: true, extra: { current_step: "we've crossed", next_step: "the radio check with Standard" } }));
  }
  return out;
}

/**
 * Canon that EXISTS in project authority but that no source grants to the current Day-1 coworkers yet
 * (ontology truth != observer knowledge). Used to classify a truthful unknown; never to answer.
 */
const CANON_NOT_GRANTED = Object.freeze({
  "threshold-room": { source: `${WORLDPACK}#mission.procedures (L2)`, reason: "facility knowledge (KV31) is not granted by baseline induction" },
  "threshold-approach": { source: "canon-lexicon CANONICAL_LOCATIONS (L2)", reason: "not briefed" },
  "task:material-delivery": { source: `${OWNER_RATIFICATION} §6`, reason: "contents and deeper purpose of the startup materials are not established" }
});
// Legacy aliases (ed28) onto the reason taxonomy.
const UNKNOWN_CLASS = Object.freeze({ CANON_NOT_GRANTED: SEMANTIC_REASON.LEGITIMATE_UNKNOWN, NO_SOURCE: SEMANTIC_REASON.LEGITIMATE_UNKNOWN, UNKNOWN_ENTITY: SEMANTIC_REASON.LEGITIMATE_UNKNOWN, MISSING_STRUCTURE: SEMANTIC_REASON.MISSING_STRUCTURED_CANON, PARTIAL: SEMANTIC_REASON.PARTIAL_KNOWLEDGE });

// ─── heard propositions (Hole 1/2): meaning from the plan that authorized the line, never its wording ──
/**
 * Structured propositions an authorized line communicated, keyed by the facts that licensed it. Surface
 * wording is never parsed back into meaning. Returns [{ concept, key, facet, entity_ids, reported }].
 */
// Third-person, past-tense report clauses for a person's own registry answers ("Tonya said it wasn't
// her first day"): a report is temporally hedged by construction (E4).
const REPORTED_SELF_CLAUSE = Object.freeze({
  "person.first_day_at_async": (a) => (a.value === "yes" ? "it was their first day" : "it wasn't their first day"),
  "person.async_tenure": (a) => ({ first_day: "it was their first day", weeks: "they'd been with ASYNC a few weeks", months: "they'd been with ASYNC a few months", years: "they'd been with ASYNC for years" }[a.answer?.band] ?? null),
  "person.expedition_experience": (a) => (a.value === "no" ? "it was their first expedition" : "they'd been on expeditions before"),
  "person.complex_experience": (a) => (a.value === "no" ? "they'd never been in the Complex" : "they'd been in the Complex before"),
  // Acquaintance is always with someone: the clause names them when the answer did.
  "person.familiarity": (a) => { const who = String(a.statements?.[0] ?? "").match(/\bmet ([A-Z][\w.]*(?: [A-Z][\w]*)?) today\b/)?.[1] ?? null; return a.value === "no" ? (who ? `they'd only met ${who} today` : "they'd only just met") : "they knew each other"; }
});
function propositionsOfPlan(plan, { speaker_id, speaker_name, names = {} } = {}) {
  const out = [];
  if (!plan) return out;
  if (plan.discourse_function === "compound") return plan.parts.flatMap((p) => propositionsOfPlan(p.plan, { speaker_id, speaker_name, names }));
  const value = (key) => (plan.required_facts ?? []).find((f) => f.key === key)?.value ?? null;
  const role = value("role");
  const assignment = value("current_assignment");
  const task = plan.fact_semantics?.current_assignment?.task ?? null;
  if (role) out.push({ concept: "role_or_assignment", key: "role", facet: "role", entity_ids: [speaker_id], reported: `they're ${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}` });
  if (assignment) out.push({ concept: "role_or_assignment", key: "current_assignment", facet: "assignment", entity_ids: [speaker_id, ...(task ? [`task:${task}`] : [])], reported: `they're ${sentence(assignment).replace(/^I'm\s+/i, "").replace(/^./, (c) => c.toLowerCase())}` });
  for (const fact of plan.fact_semantics?.knowledge?.facts ?? []) {
    if (!fact.reported) continue;
    // Reporting chain (minimal): a line that relayed the briefing is "<speaker> said Maxwell said ...",
    // never first-hand Maxwell knowledge for whoever hears it.
    const origin = fact.provenance === "briefing" ? "Maxwell" : null;
    out.push({ concept: fact.concept ?? plan.fact_semantics.knowledge.concept, key: fact.key, facet: fact.facet ?? null, entity_ids: [fact.entity_id, plan.fact_semantics.knowledge.entity_id].filter(Boolean), reported: origin && !/^Maxwell\b/.test(fact.reported) ? `Maxwell said ${fact.reported}` : fact.reported, ...(origin ? { origin } : {}) });
  }
  // What the line said was NOT known is part of what it communicated ("nobody's told me what's in them").
  const gap = value("knowledge_gap");
  const GAP_REPORTED = { purpose_and_contents: "nobody had told them what's in them or what they're for", purpose: "nobody had told them what it's for", contents: "nobody had told them what's in them", mechanism: "nobody had told them how it works", origin: "nobody had told them where it came from", history: "they didn't know anything more about the company", command: "they didn't know who's in charge beyond that" };
  if (gap && GAP_REPORTED[gap.missing]) out.push({ concept: plan.fact_semantics?.knowledge?.concept ?? gap.concept ?? null, key: `gap_${gap.missing}`, facet: "gap", entity_ids: [plan.fact_semantics?.knowledge?.entity_id].filter(Boolean), reported: GAP_REPORTED[gap.missing] });
  const holder = value("item_holder");
  if (holder?.label && holder.holder_name && holder.holder_known !== false) {
    const itemId = plan.fact_semantics?.custody?.equipment_id ?? null;
    const heldBy = holder.holder_is_self ? speaker_name : holder.holder_name;
    out.push({ concept: "custody", key: "item_holder", facet: "custody", entity_ids: [itemId].filter(Boolean), reported: `the ${String(holder.label).toLowerCase()} was with ${heldBy === "you" ? "you" : heldBy}`, holder: holder.holder_is_self ? speaker_id : (Object.entries(names).find(([, n]) => n === holder.holder_name)?.[0] ?? null) });
  }
  // ED-30: a registry answer about oneself is heard as that person's own statement (reported later in the
  // past tense, never converted into a present-tense fact about them).
  const answer = value("predicate_answer");
  if (answer && !answer.answer?.reported && !answer.answer?.third_party && ["yes", "no", "value"].includes(answer.value)) {
    const clause = REPORTED_SELF_CLAUSE[answer.predicate]?.(answer) ?? null;
    if (clause) out.push({ concept: answer.predicate, key: answer.predicate, predicate: answer.predicate, facet: "self_report", entity_ids: [speaker_id].filter(Boolean), polarity: answer.value, reported: clause, ...(answer.answer?.other_id ? { other_id: answer.answer.other_id } : {}) });
  }
  const selfState = value("self_state");
  if (selfState && ["check_in", "social_observation"].includes(plan.discourse_function)) {
    const affect = (selfState.affect ?? []).filter((a) => !/PLAYER/.test(a));
    const stance = value("self_state_answer");
    const predicate = stance?.asked === "tense" ? "person.nervousness" : stance?.asked === "tired" ? "person.fatigue" : stance?.asked === "positive" ? "person.anticipation" : "person.wellbeing";
    out.push({ concept: predicate, key: predicate, predicate, facet: "self_report", entity_ids: [speaker_id].filter(Boolean), polarity: affect.length ? "affected" : "ordinary", reported: affect.length ? `they were ${affect.join(" and ")}` : (predicate === "person.wellbeing" ? "they were doing all right" : `they weren't especially ${predicate === "person.nervousness" ? "nervous" : predicate === "person.fatigue" ? "tired" : "excited"}`) });
  }
  const procedure = value("current_procedure");
  if (procedure?.next_step) out.push({ concept: "current_procedure", key: "current_procedure", facet: "next_step", entity_ids: [], reported: `${procedure.current_step ? `we ${sentence(procedure.current_step)}, then ` : "we "}${sentence(procedure.next_step)}` });
  return out;
}

/**
 * Everything this actor HEARD said (canonical dialogue_history rows they were a listener of, plus the
 * delivered briefing lines): speaker, proposition, topic entities, source event, listeners and epistemic
 * form. Player lines are kept as attributed PLAYER CLAIMS (surface quotation only) and never become world
 * truth. The transcript is not stored as truth: meaning comes from the authorizing plan.
 */
function heardPropositions(run, actorId) {
  const out = [];
  if (!run?.expedition || !actorId) return out;
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const members = run.expedition.team?.members ?? [];
  const names = Object.fromEntries([...members.map((m) => [idOf(m), m.first_name ?? m.display_name ?? null]), [playerId, "you"]]);
  const receipts = new Map((run.expedition.communication_receipts ?? []).map((r) => [r.id, r]));
  let index = null;
  for (const event of run.expedition.dialogue_history ?? []) {
    if (event?.kind !== "speech" || !event.speaker_id || event.speaker_id === actorId) continue;
    if (!["delivered", "heard"].includes(event.delivery ?? "delivered")) continue;
    if (String(event.channel ?? "LOCAL").toLowerCase() !== "local") continue;
    if (!(event.listeners ?? []).includes(actorId)) continue;
    const at = Number.isFinite(Number(event.interval)) ? Number(event.interval) : null;
    const base = { speaker_id: event.speaker_id, source_event: event.id ?? null, interaction: event.submission_id ?? null, listeners: [...(event.listeners ?? [])], at, source_ref: `dialogue_history.${event.submission_id ?? event.id}` };
    if (event.speaker_id === playerId) {
      index ??= entityIndex(run);
      const text = clean(event.text).slice(0, 400);
      // A question asserts nothing: only the player's declaratives are remembered as their claims.
      if (/\?\s*$/.test(text) || /^(?:who|what|where|when|why|how|which|is|are|do|does|did|can|could|will|would|should)\b/i.test(text)) continue;
      out.push({ ...base, speaker_name: "you", epistemic_mode: "player_claim", concept: "player_claim", key: "player_claim", entity_ids: resolveEntityMentions(text, index).map((e) => e.id), text, reported: null });
      continue;
    }
    const plan = (receipts.get(event.submission_id)?.response_contexts ?? []).find((c) => c.target_worker_id === event.speaker_id)?.response_plan ?? null;
    const speakerName = event.speaker_name ?? names[event.speaker_id] ?? null;
    for (const p of propositionsOfPlan(plan, { speaker_id: event.speaker_id, speaker_name: speakerName, names })) {
      // Reported by someone else, the speaker's own name in their proposition becomes "they".
      const reported = speakerName && p.reported ? p.reported.replace(new RegExp(`^((?:Maxwell said )?)${escapeRe(speakerName)} is\\b`), "$1they're").replace(new RegExp(`^((?:Maxwell said )?)${escapeRe(speakerName)} has\\b`), "$1they have") : p.reported;
      out.push({ ...base, speaker_name: speakerName, epistemic_mode: PROVENANCE.HEARD, ...p, reported });
    }
  }
  // Maxwell's delivered briefing lines, heard in the room (same grants as the briefing knowledge).
  const maxwellId = maxwellIdOf(run);
  const grants = briefingKnowledge(run, actorId);
  for (const beat of deliveredBriefing(run).filter((b) => b.listeners.includes(actorId))) {
    for (const f of briefingPropositionsFor(run, actorId, beat, grants)) out.push({ speaker_id: maxwellId, speaker_name: "Maxwell", source_event: `briefing.${beat.key}`, interaction: null, listeners: [...beat.listeners], at: beat.at_interval, source_ref: f.source_ref, epistemic_mode: PROVENANCE.BRIEFING, concept: f.concept, key: f.key, facet: f.facet, entity_ids: [f.entity_id, f.task].filter(Boolean), reported: f.reported });
  }
  return out;
}
/** The briefing grants a single delivered beat produced for this actor (Maxwell's spoken propositions). */
function briefingPropositionsFor(run, actorId, beat, grants = null) {
  const keys = new Set(BRIEFING_BEAT_PROPOSITIONS[beat.key] ?? []);
  return (grants ?? briefingKnowledge(run, actorId)).filter((f) => keys.has(f.key) && f.epistemic_mode === PROVENANCE.BRIEFING && f.reported);
}

/** Self-descriptions (role/assignment) other coworkers gave in this actor's hearing (compatibility view). */
function heardSelfDescriptions(run, actorId) {
  const bySource = new Map();
  for (const p of heardPropositions(run, actorId)) {
    if (p.epistemic_mode !== PROVENANCE.HEARD || p.concept !== "role_or_assignment" || !["role", "current_assignment"].includes(p.key)) continue;
    const entry = bySource.get(p.source_ref) ?? { person_id: p.speaker_id, name: p.speaker_name, bits: [], source_ref: p.source_ref };
    entry.bits.push(p.reported);
    bySource.set(p.source_ref, entry);
  }
  return [...bySource.values()].map((e) => ({ person_id: e.person_id, name: e.name, what: e.bits.join(" and "), source_ref: e.source_ref }));
}

/**
 * "What did Clint say the materials were for?" / "Who said we were going to Equipment Staging?" / "What
 * did I say Maxwell told me?": attributed propositions this actor heard, filtered by speaker and topic.
 * Conflicting claims from different speakers are ALL returned, each attributed; nothing is collapsed.
 */
function reportedSpeech(run, { actor_id, speaker_id = null, entity_ids = [], concept = null } = {}) {
  // "What did YOU say?" asked of the speaker is their OWN speech (own-speech provenance), never hearsay.
  const own = speaker_id && speaker_id === actor_id;
  const heardAll = own ? ownSpeechPropositions(run, actor_id) : heardPropositions(run, actor_id);
  const bySpeaker = speaker_id ? heardAll.filter((p) => p.speaker_id === speaker_id) : heardAll;
  const concepts = concept === "current_procedure" ? ["current_procedure", "briefing_instruction"] : [concept];
  const topical = (p) => (!entity_ids.length && !concept) || entity_ids.some((id) => p.entity_ids.includes(id)) || (concept && concepts.includes(p.concept));
  const matches = bySpeaker.filter(topical);
  // A player line matches its topic by the canonical entities it NAMED (never by what it asserted).
  const status = matches.length ? "known" : bySpeaker.length ? "not_on_topic" : "not_heard";
  // Repetition is counted, never promoted: frequency is not truth.
  const counts = new Map();
  for (const p of matches) { const k = `${p.speaker_id}|${p.reported ?? p.text}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const seen = new Set();
  const unique = matches.filter((p) => { const k = `${p.speaker_id}|${p.reported ?? p.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return Object.freeze({ status, speaker_id, own_speech: Boolean(own), heard_speaker: bySpeaker.length > 0, claims: unique.slice(-12).map((p) => ({ speaker_id: p.speaker_id, speaker_name: p.speaker_name, epistemic_mode: p.epistemic_mode, key: p.key, concept: p.concept, reported: p.reported, text: p.text ?? null, ...(p.line ? { line: p.line } : {}), entity_ids: p.entity_ids, source_event: p.source_event, source_ref: p.source_ref, interaction: p.interaction ?? null, at: p.at, times: counts.get(`${p.speaker_id}|${p.reported ?? p.text}`) ?? 1, ...(p.origin ? { origin: p.origin } : {}) })) });
}
/** The actor's OWN earlier lines, as propositions (own-speech provenance; never "heard myself"). */
function ownSpeechPropositions(run, actorId) {
  const out = [];
  const receipts = new Map((run?.expedition?.communication_receipts ?? []).map((r) => [r.id, r]));
  for (const event of run?.expedition?.dialogue_history ?? []) {
    if (event?.kind !== "speech" || event.speaker_id !== actorId || !event.submission_id) continue;
    const plan = (receipts.get(event.submission_id)?.response_contexts ?? []).find((c) => c.target_worker_id === actorId)?.response_plan ?? null;
    for (const p of propositionsOfPlan(plan, { speaker_id: actorId, speaker_name: "I" })) out.push({ speaker_id: actorId, speaker_name: "I", epistemic_mode: "own_speech", source_event: event.id ?? null, source_ref: `dialogue_history.${event.submission_id}`, interaction: event.submission_id, at: event.interval ?? null, line: event.text ?? null, ...p });
  }
  return out;
}

/**
 * Custody over time for one item, from THIS actor's observations (and the briefing's roster snapshot).
 * Current custody is never taken from memory: callers use the observer authority for "who has it now";
 * this answers "who had it earlier".
 */
function custodyHistory(run, actorId, itemId) {
  const item = run?.expedition?.equipment?.[itemId] ?? Object.values(run?.expedition?.equipment ?? {}).find((e) => e?.id === itemId) ?? null;
  if (!item) return [];
  const member = (run.expedition.team?.members ?? []).find((m) => idOf(m) === actorId) ?? null;
  const out = [];
  const briefed = briefedCustody(run, actorId).get(item.id);
  const roster = deliveredBriefing(run).find((b) => b.key === "roster_call" && b.listeners.includes(actorId));
  if (briefed) out.push({ holder_id: briefed.holder_id, at: roster?.at_interval ?? null, epistemic_mode: PROVENANCE.BRIEFING, when: "at the briefing", source_ref: briefed.source_ref });
  for (const entry of member?.known_information ?? []) {
    if (entry.kind !== "custody-observed" || (entry.equipment_id !== itemId && entry.equipment_id !== item.id)) continue;
    out.push({ holder_id: entry.holder_id, at: entry.at ?? null, epistemic_mode: PROVENANCE.OBSERVED, when: "earlier", source_ref: `known_information.custody-observed@${entry.at}` });
  }
  return out;
}

// ─── the query ───────────────────────────────────────────────────────────────────────────────────
// Concepts consulted as CONTEXT (never as the answer) when the asked facet is not established.
const RELATED = Object.freeze({ briefing_instruction: [], person_presence: [], custody: [], institution_purpose: ["mission_objective"], mission_objective: [], current_procedure: [], schedule: [], person_identity: ["person_role"], person_role: ["person_authority", "person_identity"], person_authority: ["person_role", "person_identity"], person_relation: ["person_role", "person_identity"], role_or_assignment: [], assignment_purpose: ["role_or_assignment"], entity_definition: ["assignment_purpose", "field_procedure"], entity_state: [], field_procedure: ["assignment_purpose"], location_purpose: [], current_action: ["current_procedure"] });
// Concepts whose facts ANSWER a question of this concept (a coworker's identity is answered by what the
// roster/their own words said they do; a task or procedure is defined by its purpose / procedure).
const ANSWERING = Object.freeze({ person_identity: ["person_identity", "role_or_assignment"], entity_definition: ["entity_definition", "assignment_purpose", "field_procedure", "institution_purpose"], assignment_purpose: ["assignment_purpose", "field_procedure"], field_procedure: ["field_procedure"], current_action: ["current_action"] });
const ANSWERING_FACETS = Object.freeze({ person_identity: ["identity", "address_form", "assignment", "role"], entity_definition: ["definition", "purpose", "procedure"], assignment_purpose: ["purpose", "procedure"], person_authority: ["authority"], mission_objective: ["objective", "assignment_kind"], institution_purpose: ["purpose", "employer"] });

/**
 * The observer-safe answer material for ONE semantic query.
 *   status: "known" (the asked facet is established) | "partial" (related knowledge, the asked detail is
 *   not) | "not_established" (entity known, nothing established) | "unknown_entity".
 * `facet` narrows what is asked ("mechanism" for "how does it work?", "command" for "who's in charge?").
 */
function queryKnowledge(run, { actor_id, concept, entity = null, facts = null, facet = null, speaker_id = null, topic_concept = null } = {}) {
  if (concept === "reported_speech") {
    const r = reportedSpeech(run, { actor_id, speaker_id, entity_ids: entity ? [entity.id, ...(entity.related_ids ?? [])].filter(Boolean) : [], concept: topic_concept });
    return Object.freeze({ version: KNOWLEDGE_VERSION, concept, entity: entity ? { id: entity.id, kind: entity.kind, label: entity.label } : null, speaker_id, status: r.status === "known" ? "known" : "not_established", unknown_reason: r.status === "known" ? null : SEMANTIC_REASON.LEGITIMATE_UNKNOWN, reported: r, facts: [] });
  }
  if (!CONCEPTS.includes(concept)) return Object.freeze({ version: KNOWLEDGE_VERSION, concept, entity, status: "unsupported_concept", unknown_reason: SEMANTIC_REASON.INTERPRETATION_FAILURE, facts: [] });
  // An unrecognized name ("Who is Bob?") resolves to nothing: no fact about anyone else answers it.
  if (entity && !entity.id) return Object.freeze({ version: KNOWLEDGE_VERSION, concept, requested_facet: facet ?? null, entity: { id: null, kind: entity.kind ?? null, label: entity.label ?? null }, status: "unknown_entity", unknown_reason: SEMANTIC_REASON.LEGITIMATE_UNKNOWN, missing_requested_detail: null, bounded_unknown: null, facts: [] });
  const raw = facts ?? knowledgeFor(run, actor_id);
  // A heard report of something the actor already holds first-hand adds a source, not an answer.
  const ownKeys = new Set(raw.filter((f) => f.epistemic_mode !== PROVENANCE.HEARD).map((f) => f.key));
  const ownReported = new Set(raw.filter((f) => f.epistemic_mode !== PROVENANCE.HEARD && f.reported).map((f) => f.reported));
  const all = raw.filter((f) => f.epistemic_mode !== PROVENANCE.HEARD || !(ownKeys.has(String(f.key).replace(/^heard_/, "")) || ownReported.has(f.reported)));
  const entityIds = entity?.id ? [entity.id, ...(entity.related_ids ?? [])] : null;
  const entityScoped = ["person_identity", "person_role", "person_authority", "person_relation", "role_or_assignment", "entity_definition", "entity_state", "assignment_purpose", "field_procedure", "location_purpose"];
  const matches = (f, c) => f.concept === c && (!entityIds || !f.entity_id || entityIds.includes(f.entity_id)) && (!entityIds || f.entity_id || !entityScoped.includes(c));
  const requested = facet ? [facet] : (ANSWERING_FACETS[concept] ?? [DEFAULT_FACET[concept]].filter(Boolean));
  const answeringConcepts = ANSWERING[concept] ?? [concept];
  const answering = all.filter((f) => answeringConcepts.some((c) => matches(f, c)) && (!requested.length || requested.includes(f.facet)));
  let context = [];
  if (!answering.length) {
    context = all.filter((f) => answeringConcepts.some((c) => matches(f, c)));
    if (!context.length) for (const related of RELATED[concept] ?? []) { context = all.filter((f) => matches(f, related) && (!entityIds || f.entity_id)); if (context.length) break; }
  }
  const found = answering.length ? answering : context;
  const status = answering.length ? "known" : context.length ? "partial" : (entity && entity.unknown ? "unknown_entity" : "not_established");
  // WHY it is unknown or incomplete (developer trace / report). Only real ignorance may be voiced as such.
  const unknown_reason = status === "known" ? null
    : status === "partial" ? SEMANTIC_REASON.PARTIAL_KNOWLEDGE
      : status === "unknown_entity" ? SEMANTIC_REASON.LEGITIMATE_UNKNOWN
        : (entity && CANON_NOT_GRANTED[entity.id]) ? SEMANTIC_REASON.LEGITIMATE_UNKNOWN
          : SEMANTIC_REASON.LEGITIMATE_UNKNOWN;
  // Finer internal class of an empty/partial result (developer trace only).
  const unknown_detail = status === "known" ? null : status === "partial" ? "facet_unknown" : status === "unknown_entity" ? "entity_unknown" : (entity?.world_only ? "not_granted_to_actor" : (entity && CANON_NOT_GRANTED[entity.id]) ? "not_granted_to_actor" : "legitimate_unknown");
  const missing = status === "partial" ? (facet ?? (found.find((f) => f.missing_facets)?.missing_facets?.join("_and_") ?? requested[0] ?? null)) : null;
  const bounded = status === "known" ? (answering.find((f) => f.bounded_unknown)?.bounded_unknown ?? null) : null;
  // Answering facts first, then at most one context fact (the owner of an assignment, say).
  // The most specific source first (what was said or seen today before general orientation).
  const RANK = { briefing: 0, observed: 1, heard: 2, self: 3, recorded: 4, baseline_field_procedure: 5, baseline_induction: 6 };
  const facetRank = (f) => { const i = requested.indexOf(f.facet); return i < 0 ? requested.length : i; };
  const ordered = [...found].sort((a, b) => facetRank(a) - facetRank(b) || (RANK[a.provenance] ?? 9) - (RANK[b.provenance] ?? 9));
  return Object.freeze({
    version: KNOWLEDGE_VERSION,
    concept,
    requested_facet: facet ?? requested[0] ?? null,
    entity: entity ? { id: entity.id, kind: entity.kind, label: entity.label, ...(entity.world_only ? { world_only: true } : {}) } : null,
    status,
    unknown_reason,
    unknown_detail,
    missing_requested_detail: missing,
    bounded_unknown: bounded,
    // Asked about no one in particular ("Who's in charge?"), a pronoun statement names its person instead.
    facts: ordered.slice(0, 3).map((f) => ({ ...(f.speaker_id ? { speaker_id: f.speaker_id } : {}), key: f.key, concept: f.concept, facet: f.facet, statement: !entity && /^(?:He|She)(?:'s| is)\b/.test(f.statement) && f.reported ? `${f.reported.charAt(0).toUpperCase()}${f.reported.slice(1)}.` : f.statement, reported: f.reported ?? null, entity_id: f.entity_id ?? null, provenance: f.provenance, authority_class: f.authority_class ?? null, source_ref: f.source_ref, commit_sensitive: Boolean(f.commit_sensitive), ...(f.next_step !== undefined ? { next_step: f.next_step, current_step: f.current_step } : {}) }))
  });
}

/** Whether an actor may know about an entity at all (reference needs no presence; knowledge does). */
function knowsEntity(run, actorId, entityId) {
  return knowledgeFor(run, actorId).some((f) => f.entity_id === entityId);
}

module.exports = { ownSpeechPropositions, briefingKnowledge, AUTHORITY, CANON_NOT_GRANTED, UNKNOWN_CLASS, SEMANTIC_REASON, CHARACTER_IGNORANCE, BRIEFING_BEAT_PROPOSITIONS, DEFAULT_FACET, briefedCustody, KNOWLEDGE_VERSION, PROVENANCE, CONCEPTS, TASK_ALIASES, TASK_ITEMS, PROCEDURE_ENTITIES, entityIndex, resolveEntityMentions, deliveredBriefing, rosterAssignments, baselineKnowledge, knowledgeFor, heardSelfDescriptions, heardPropositions, propositionsOfPlan, reportedSpeech, custodyHistory, procedureState, queryKnowledge, knowsEntity, isDay1ExpeditionMember };
