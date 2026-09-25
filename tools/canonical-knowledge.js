"use strict";

// Canonical actor knowledge: WHAT an actor may know, composed deterministically from canonical sources,
// each fact carrying its provenance. This module is a pure projection of persisted canonical state (the
// delivered briefing lines and who heard them, the roster, equipment, heard dialogue and its authorized
// plans, the canon lexicon). Nothing here is stored separately, nothing is inferred from a role title,
// and nothing comes from a language model. Knowing a fact is NOT permission to say it: the response plan
// decides what a turn may communicate.
//
// Knowledge classes (provenance):
//   self          the actor's own name, role, assignment, held equipment
//   briefing      a briefing line the actor was present for (personnel_briefing.exchange_history)
//   institutional reserved: no Day-1 source grants institutional definitions to coworkers yet (see
//                 CANON_NOT_GRANTED); ontology truth is not observer knowledge
//   observed      the actor's own canonical observations (present people, attended events)
//   heard         what another person said in the actor's hearing (report form, never first-hand)
//   recorded      institutional records explicitly granted to the actor (via the context compiler)

const canonLexicon = require("./canon-lexicon");
const opener = require("./cq4-day1-opener");
const openerDefinition = require("../data/worldpacks/clear-q4/cq4-day1-opener.json");

const KNOWLEDGE_VERSION = "yellow-beast-canonical-knowledge@v1";
const PROVENANCE = Object.freeze({ SELF: "self", BRIEFING: "briefing", INSTITUTIONAL: "institutional", OBSERVED: "observed", HEARD: "heard", RECORDED: "recorded" });
// Semantic concepts a response plan may query. Each is a KIND of question, never an answer phrase.
const CONCEPTS = Object.freeze(["institution_purpose", "mission_objective", "current_procedure", "schedule", "person_identity", "role_or_assignment", "assignment_purpose", "entity_definition"]);

const idOf = (member) => member?.personnel_id ?? member?.id ?? null;
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const sentence = (text) => clean(text).replace(/[.!?\s]+$/, "");
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─── canonical entity index (reference does not require presence; knowledge does) ───────────────
// Lexical aliases name a canonical entity/task; they are language, never facts.
const TASK_ALIASES = Object.freeze({
  "verbal-recall": ["observation and verbal recall", "verbal recall", "verbal record", "recall", "recording", "record", "observations", "observation", "notes"],
  "material-delivery": ["startup materials", "startup material", "startup prerequisite materials", "materials", "material", "delivery", "delivering", "duffle", "the bag"],
  "layout-compilation": ["layout record", "layout", "compiling", "the record"]
});
const TASK_ITEMS = Object.freeze({ "material-delivery": /duffle|startup/i, "layout-compilation": /layout/i, "verbal-recall": null });
const PLACE_ENTITIES = Object.freeze({
  complex: { id: "complex", kind: "entity", label: "the Complex", names: ["the complex", "complex"] },
  standard: { id: "standard", kind: "entity", label: "STANDARD", names: ["standard"] },
  "outpost-a": { id: "outpost-a", kind: "location", label: "Outpost A", names: ["outpost a", "the outpost", "outpost", "bermuda branch", "bermuda"] },
  async: { id: "async", kind: "institution", label: "ASYNC", names: ["async", "a-sync", "the company", "this company", "this place", "this outfit", "this facility"] }
});

/** Every canonical entity the actor's words could refer to, with its lexical names. */
function entityIndex(run) {
  const out = [];
  const add = (entry) => out.push({ ...entry, names: [...new Set(entry.names.map((n) => String(n).toLowerCase()).filter(Boolean))] });
  const playerId = run?.session?.startup?.player?.observer_id ?? null;
  for (const member of run?.expedition?.team?.members ?? []) {
    add({ id: idOf(member), kind: "person", label: member.first_name ?? member.display_name, names: [member.first_name, member.last_name, member.display_name, ...(member.aliases ?? [])].filter(Boolean), is_player: idOf(member) === playerId });
  }
  const authority = run?.expedition?.day1_opener ? (run.expedition.mission?.briefing_authority ?? openerDefinition.briefing_authority) : null;
  if (authority) add({ id: authority.identity ?? "dr-kirk-maxwell", kind: "person", label: authority.name, names: ["kirk", "maxwell", "dr. maxwell", "dr maxwell", "kirk maxwell", "dr. kirk maxwell", "doctor maxwell", "the doctor who briefed us", "the briefing doctor"], non_present: true });
  for (const location of Object.values(canonLexicon.CANONICAL_LOCATIONS ?? {})) add({ id: location.id, kind: "location", label: location.display_name, names: [location.display_name, location.display_name.replace(/^ASYNC\s+/i, ""), ...(location.id === "equipment-staging" ? ["staging"] : []), ...(location.id === "threshold-room" ? ["kv31"] : [])] });
  for (const entity of Object.values(canonLexicon.CANONICAL_ENTITIES ?? {})) add({ id: entity.id, kind: "entity", label: entity.display_name, names: [entity.bare_name, entity.display_name] });
  for (const place of Object.values(PLACE_ENTITIES)) add(place);
  for (const item of Object.values(run?.expedition?.equipment ?? {})) if (item?.id && item.label) add({ id: item.id, kind: "equipment", label: item.label, names: [item.label, item.type, String(item.label).split(/\s+/).at(-1)].filter(Boolean) });
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
    for (const name of entry.names) {
      if (name.length < 3) continue;
      const match = raw.match(new RegExp(`[^a-z0-9]${escapeRe(name)}(?:'s)?[^a-z0-9]`));
      if (match) { hits.push({ entry, name, at: match.index }); break; }
    }
  }
  // A longer overlapping name wins ("equipment staging" over "staging"; "layout record" item over task).
  hits.sort((a, b) => b.name.length - a.name.length);
  const kept = [];
  for (const hit of hits) if (!kept.some((k) => k.at <= hit.at && hit.at + hit.name.length <= k.at + k.name.length + 1 && k.entry.id !== hit.entry.id && k.name.includes(hit.name))) kept.push(hit);
  return kept.sort((a, b) => a.at - b.at).map((hit) => ({ id: hit.entry.id, kind: hit.entry.kind, label: hit.entry.label, matched: hit.name, ...(hit.entry.non_present ? { non_present: true } : {}), ...(hit.entry.is_player ? { is_player: true } : {}) }));
}

// ─── the delivered briefing (what was actually said, and to whom) ───────────────────────────────
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
    .map((entry) => ({ key: keyFor(entry), text: clean(entry.text), listeners: Array.isArray(entry.listeners) ? entry.listeners : legacyListeners }))
    .filter((beat) => beat.key);
}

/** The roster call's per-person assignments, parsed from the authored TEMPLATE (never from prose). */
function rosterAssignments(run) {
  const template = (run?.expedition?.mission?.briefing_authority ?? openerDefinition.briefing_authority)?.dialogue?.roster_call ?? "";
  const members = run?.expedition?.team?.members ?? [];
  const slotMember = { player_name: members[0], coworker1_name: members[1], coworker2_name: members[2], coworker3_name: members[3] };
  const out = [];
  for (const part of template.split(/(?<=\.)\s+/)) {
    const slot = part.match(/\{(\w+)\}/)?.[1];
    const member = slot ? slotMember[slot] : null;
    if (!member) continue;
    const phrase = sentence(part.replace(/\{\w+\}/, "").replace(/^[,\s]+/, "").replace(/^you're\s+/i, ""));
    out.push({ person_id: idOf(member), name: member.first_name ?? member.display_name, phrase });
  }
  return out;
}

// Authority classes (amendment "Canon authority layers"). A grant is only ever made from L1/L2 content
// delivered through a canonical event, or from the actor's own record; L3 reference material and L4
// implementation labels never create a grant.
const AUTHORITY = Object.freeze({ L1: "L1_project_authority", L2: "L2_authored_current_slice", EVENT: "canonical_runtime_event" });
const WORLDPACK = "data/worldpacks/clear-q4/cq4-day1-opener.json";

/**
 * One auditable knowledge grant: { concept, key, proposition, authority_class, source_ref, grant_basis,
 * epistemic_mode, valid_scope, entity_id? }. `statement`/`provenance` mirror proposition/epistemic_mode
 * for the planners. NO SOURCE -> NO GRANT: every call site names its source.
 */
function grant({ concept, key, proposition, authority_class, source_ref, grant_basis, epistemic_mode, valid_scope, entity_id = null, extra = {} }) {
  return Object.freeze({ concept, key, proposition, statement: proposition, authority_class, source_ref, grant_basis, epistemic_mode, provenance: epistemic_mode, valid_scope, ...(entity_id ? { entity_id } : {}), ...extra });
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
  const template = (run?.expedition?.mission?.briefing_authority ?? openerDefinition.briefing_authority)?.dialogue?.roster_call ?? "";
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
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const nameOf = (id) => (id === actorId ? "me" : id === playerId ? "you" : members.find((m) => idOf(m) === id)?.first_name ?? null);

  // SELF: the actor's own canonical record (role from the authored staffing archetype; held equipment).
  if (self) {
    if (self.role) facts.push(grant({ concept: "role_or_assignment", key: "own_role", proposition: `I'm ${/^[aeiou]/i.test(self.role) ? "an" : "a"} ${self.role}.`, authority_class: AUTHORITY.L2, source_ref: `${WORLDPACK}#staffing.coworker_archetypes[].role -> team.member.role`, grant_basis: "own personnel record", epistemic_mode: PROVENANCE.SELF, valid_scope: "run", entity_id: actorId }));
    for (const item of Object.values(run.expedition.equipment ?? {}).filter((i) => i.holder === actorId)) facts.push(grant({ concept: "assignment_purpose", key: "own_equipment", proposition: `I'm carrying the ${String(item.label).toLowerCase()}.`, authority_class: AUTHORITY.EVENT, source_ref: `equipment.${item.id}.holder`, grant_basis: "own custody", epistemic_mode: PROVENANCE.SELF, valid_scope: "while held", entity_id: item.id }));
  }

  // BRIEFING: only lines of the authored Maxwell briefing (L2) that were delivered while this actor was
  // present (personnel_briefing.exchange_history + listeners). UI-only text (his displayed title, the
  // room card) is never a grant.
  const beats = deliveredBriefing(run).filter((beat) => beat.listeners.includes(actorId));
  const authority = run.expedition.mission?.briefing_authority ?? openerDefinition.briefing_authority;
  const maxwellId = authority?.identity ?? "dr-kirk-maxwell";
  const windowDef = run.expedition.mission?.operational_window ?? openerDefinition.operational_window ?? {};
  const heard = (key, extra) => ({ authority_class: AUTHORITY.L2, grant_basis: `present for the delivered briefing line (${key})`, epistemic_mode: PROVENANCE.BRIEFING, valid_scope: `after briefing.${key} delivered`, ...extra });
  for (const beat of beats) {
    if (beat.key === "intro") {
      facts.push(grant({ concept: "person_identity", key: "briefing_introduction", proposition: `That's ${authority?.name ?? "Dr. Kirk Maxwell"}; he said we can call him Kirk.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.intro`, entity_id: maxwellId, ...heard("intro") }));
      // Attending is an observation of an event; his title/authority was never stated aloud (UI only).
      facts.push(grant({ concept: "person_identity", key: "gave_briefing", proposition: "He gave us this morning's assignment briefing.", authority_class: AUTHORITY.EVENT, source_ref: "personnel_briefing.exchange_history (attended)", grant_basis: "attended the briefing he delivered", epistemic_mode: PROVENANCE.OBSERVED, valid_scope: "after briefing.intro delivered", entity_id: maxwellId }));
    } else if (beat.key === "mission_statement") {
      const said = sentence(beat.text).replace(/^Today's assignment is straightforward\.\s*/i, "").toLowerCase();
      facts.push(grant({ concept: "mission_objective", key: "mission_statement", proposition: `Maxwell said today's assignment is ${said}.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.mission_statement`, ...heard("mission_statement") }));
    } else if (beat.key === "schedule") {
      // The spoken schedule line is runtime-authored (L4 text); its values are the authored window (L2).
      facts.push(grant({ concept: "schedule", key: "operational_window", proposition: `Departure is at ${windowDef.deployment_time}, we're expected back by ${windowDef.expected_return_time}, and the cutoff is ${windowDef.cutoff_time}.`, source_ref: `${WORLDPACK}#operational_window (spoken by the delivered schedule beat)`, ...heard("schedule") }));
    } else if (beat.key === "roster_call") {
      for (const entry of rosterAssignments(run)) {
        const who = nameOf(entry.person_id);
        // The roster phrase as said: "has custody of ...", "on camera", "layout record".
        const predicate = (subject, be) => (/^has\b/.test(entry.phrase) ? `${subject} ${["I", "you"].includes(subject) ? entry.phrase.replace(/^has\b/, "have") : entry.phrase}` : `${subject} ${be} ${/^on\b/.test(entry.phrase) ? entry.phrase : `on ${entry.phrase}`}`);
        const said = entry.person_id === actorId ? `Maxwell said ${predicate("I", "am")}.` : who === "you" ? `Maxwell said ${predicate("you", "are")}.` : `Maxwell said ${predicate(entry.name, "is")}.`;
        facts.push(grant({ concept: "role_or_assignment", key: "briefed_assignment", proposition: said, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: entry.person_id, ...heard("roster_call") }));
        const outpost = entry.phrase.match(/scheduled for (.+)$/i)?.[1] ?? null;
        if (outpost) {
          facts.push(grant({ concept: "assignment_purpose", key: "startup_material_destination", proposition: `The startup material is scheduled for ${outpost}; that's what Maxwell said.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: "task:material-delivery", ...heard("roster_call") }));
          facts.push(grant({ concept: "entity_definition", key: "outpost_destination", proposition: `All I know is the startup material is scheduled for ${outpost}.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.roster_call`, entity_id: "outpost-a", ...heard("roster_call") }));
        }
      }
    } else if (beat.key === "dismissal") {
      const destination = sentence(beat.text).match(/report to ([A-Z][\w ]+?)(?: when|$)/)?.[1] ?? null;
      if (destination) {
        facts.push(grant({ concept: "current_procedure", key: "briefing_dismissal", proposition: `We're to get acquainted, then report to ${destination}.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, extra: { next_step: `report to ${destination}`, current_step: "get acquainted with the team" }, ...heard("dismissal") }));
        const staging = Object.values(canonLexicon.CANONICAL_LOCATIONS).find((l) => l.display_name === destination);
        if (staging) facts.push(grant({ concept: "entity_definition", key: "next_destination", proposition: `${destination} is where we report next; that's all Maxwell said about it.`, source_ref: `${WORLDPACK}#briefing_authority.dialogue.dismissal`, entity_id: staging.id, ...heard("dismissal") }));
      }
    }
  }

  // HEARD: another person's own self-description, in the actor's hearing (report form, never first-hand).
  for (const report of heardSelfDescriptions(run, actorId)) facts.push(grant({ concept: "role_or_assignment", key: "heard_self_description", proposition: `${report.name} said ${report.what}.`, authority_class: AUTHORITY.EVENT, source_ref: report.source_ref, grant_basis: "heard their self-description", epistemic_mode: PROVENANCE.HEARD, valid_scope: "after that line", entity_id: report.person_id }));
  return facts;
}

/**
 * Canon that EXISTS in project authority but that no source grants to the current Day-1 coworkers yet
 * (ontology truth != observer knowledge). Used to classify a truthful unknown; never to answer.
 */
const CANON_NOT_GRANTED = Object.freeze({
  threshold: { source: "canon-lexicon CANONICAL_ENTITIES.threshold (L2); Gameplay Constitution §3 steps 14-16 (L1)", reason: "no delivered source tells the coworkers what the Threshold is at introductions" },
  complex: { source: "Gameplay Constitution §1-3 (L1); canon-lexicon threshold.connects (L2)", reason: "not stated in the delivered briefing; onboarding (§3 step 5) is the player's, not established for coworkers" },
  standard: { source: "Gameplay Constitution §STANDARD (L1); canon-lexicon threshold.connects (L2)", reason: "not stated aloud; the 'Standard Side' title is UI-only" },
  "threshold-room": { source: `${WORLDPACK}#mission.procedures (L2)`, reason: "procedures are the institutional mission record, not briefed at introductions" },
  "threshold-approach": { source: "canon-lexicon CANONICAL_LOCATIONS (L2)", reason: "not briefed" },
  async: { source: "Gameplay Constitution (L1 prose); no structured institutional definition", reason: "missing structured canon; not granted to coworkers" }
});
const UNKNOWN_CLASS = Object.freeze({ CANON_NOT_GRANTED: "legitimate_unknown:canon_not_granted", NO_SOURCE: "legitimate_unknown:no_source", UNKNOWN_ENTITY: "legitimate_unknown:no_such_entity", MISSING_STRUCTURE: "missing_structured_canon" });

/** Self-descriptions (role/assignment) other coworkers gave in this actor's hearing, from their plans. */
function heardSelfDescriptions(run, actorId) {
  const out = [];
  const receipts = new Map((run?.expedition?.communication_receipts ?? []).map((r) => [r.id, r]));
  for (const event of run?.expedition?.dialogue_history ?? []) {
    if (event?.kind !== "speech" || !event.speaker_id || event.speaker_id === actorId) continue;
    if (!(event.listeners ?? []).includes(actorId)) continue;
    const plan = (receipts.get(event.submission_id)?.response_contexts ?? []).find((c) => c.target_worker_id === event.speaker_id)?.response_plan ?? null;
    if (!plan || !["invite_self_description", "ask_role_or_assignment"].includes(plan.discourse_function)) continue;
    const value = (key) => (plan.required_facts ?? []).find((f) => f.key === key)?.value ?? null;
    const bits = [value("role") ? `they're ${/^[aeiou]/i.test(value("role")) ? "an" : "a"} ${value("role")}` : null, value("current_assignment") ? `they're ${value("current_assignment")}` : null].filter(Boolean);
    if (bits.length) out.push({ person_id: event.speaker_id, name: event.speaker_name ?? null, what: bits.join(" and "), source_ref: `dialogue_history.${event.submission_id}` });
  }
  return out;
}

/**
 * The observer-safe answer material for ONE semantic query. Related concepts are consulted only where
 * the question's meaning makes them the relevant known fact (an institution-purpose question is answered
 * by what the actor was told about today's assignment; STANDARD/the Complex by the Threshold definition).
 * status: "known" | "not_established" (entity known, nothing established) | "unknown_entity".
 */
const RELATED = Object.freeze({ institution_purpose: ["mission_objective"], mission_objective: [], current_procedure: [], schedule: [], person_identity: ["role_or_assignment"], role_or_assignment: [], assignment_purpose: ["role_or_assignment"], entity_definition: ["assignment_purpose"] });
function queryKnowledge(run, { actor_id, concept, entity = null, facts = null } = {}) {
  if (!CONCEPTS.includes(concept)) return Object.freeze({ version: KNOWLEDGE_VERSION, concept, entity, status: "unsupported_concept", facts: [] });
  const all = facts ?? knowledgeFor(run, actor_id);
  const entityIds = entity ? [entity.id, ...(entity.related_ids ?? [])] : null;
  const matches = (f, c) => f.concept === c && (!entityIds || !f.entity_id || entityIds.includes(f.entity_id)) && (!entityIds || f.entity_id || !["person_identity", "role_or_assignment", "entity_definition", "assignment_purpose"].includes(c));
  let found = all.filter((f) => matches(f, concept));
  if (!found.length) for (const related of RELATED[concept] ?? []) { found = all.filter((f) => matches(f, related) && (!entityIds || f.entity_id)); if (found.length) break; }
  const status = found.length ? "known" : (entity && entity.unknown ? "unknown_entity" : "not_established");
  // WHY it is unknown (developer trace / report): the canon exists but is not granted, no source
  // establishes it for this actor, the entity does not exist, or the canon is prose-only.
  const unknown_reason = status === "known" ? null
    : status === "unknown_entity" ? UNKNOWN_CLASS.UNKNOWN_ENTITY
      : (entity && CANON_NOT_GRANTED[entity.id]) ? (entity.id === "async" ? UNKNOWN_CLASS.MISSING_STRUCTURE : UNKNOWN_CLASS.CANON_NOT_GRANTED)
        : concept === "institution_purpose" ? UNKNOWN_CLASS.MISSING_STRUCTURE : UNKNOWN_CLASS.NO_SOURCE;
  return Object.freeze({ version: KNOWLEDGE_VERSION, concept, entity: entity ? { id: entity.id, kind: entity.kind, label: entity.label } : null, status, unknown_reason, facts: found.slice(0, 3).map((f) => ({ key: f.key, statement: f.statement, provenance: f.provenance, authority_class: f.authority_class, source_ref: f.source_ref, ...(f.next_step ? { next_step: f.next_step, current_step: f.current_step } : {}) })) });
}

/** Whether an actor may know about an entity at all (reference needs no presence; knowledge does). */
function knowsEntity(run, actorId, entityId) {
  return knowledgeFor(run, actorId).some((f) => f.entity_id === entityId);
}

module.exports = { AUTHORITY, CANON_NOT_GRANTED, UNKNOWN_CLASS, briefedCustody, KNOWLEDGE_VERSION, PROVENANCE, CONCEPTS, TASK_ALIASES, TASK_ITEMS, entityIndex, resolveEntityMentions, deliveredBriefing, rosterAssignments, knowledgeFor, heardSelfDescriptions, queryKnowledge, knowsEntity };
