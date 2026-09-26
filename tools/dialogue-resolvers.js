"use strict";

// Deterministic resolvers for Semantic Registry predicates (ED-30 C3).
//
// A resolver answers ONE predicate for ONE speaker from canonical state + that speaker's own knowledge:
//
//   resolve(run, { actor_id, predicate, args, temporal }) ->
//     { value: "yes"|"no"|"value"|"partial"|"unknown"|"not_established",
//       answer: {...structured...}, statements: [...], provenance: [...], sources: [...] }
//
//   unknown          the fact exists but THIS speaker does not know it (speaker ignorance)
//   not_established  the world has not determined it (nobody could say)
//
// Resolvers never consult a model and never read wording. Every statement they return is a proposition
// the response plan may license; the validator holds the model to them. A lore facet added later is a
// registry entry plus one function registered here (registerResolver).

const canonicalKnowledge = require("./canonical-knowledge");
const personhood = require("./dialogue-personhood");
const canonLexicon = require("./canon-lexicon");

const RESOLVER_VERSION = "yellow-beast-dialogue-resolvers@v1";
const idOf = (member) => member?.personnel_id ?? member?.id ?? null;
const memberOf = (run, id) => (run?.expedition?.team?.members ?? []).find((m) => idOf(m) === id) ?? null;
const grantsOf = (run, actorId) => canonicalKnowledge.knowledgeFor(run, actorId);
const result = (value, extra = {}) => Object.freeze({ version: RESOLVER_VERSION, value, answer: null, statements: [], provenance: [], sources: [], ...extra });

// Places inside the Complex (entering any of them means having been in the Complex).
const COMPLEX_PLACES = new Set(["complex", "outpost-a", "threshold"]);

// Band wording the fallback and the validator share (the precision canon stores; nothing finer).
const TENURE_PHRASE = Object.freeze({ first_day: "today's my first day", weeks: "I've been with ASYNC a few weeks", months: "I've been with ASYNC a few months", years: "I've been with ASYNC for years" });

function selfOnly(args, actorId) { return !args?.subject_id || args.subject_id === actorId; }

/**
 * A third party's SELF_HISTORY / SELF_PRIVATE fact is known to the speaker only as a REPORT of what that
 * person said in the speaker's hearing (never as first-hand truth, E3/E4).
 */
function reportedAbout(run, actorId, subjectId, predicateId) {
  const heard = canonicalKnowledge.heardPropositions(run, actorId).filter((p) => p.speaker_id === subjectId && p.predicate === predicateId);
  return heard.at(-1) ?? null;
}

const RESOLVERS = {
  profile_first_day(run, { actor_id, args }) {
    if (!selfOnly(args, actor_id)) {
      const report = reportedAbout(run, actor_id, args.subject_id, "person.first_day_at_async");
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null, polarity: report.polarity }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) }, provenance: [] });
    }
    const profile = personhood.profileOf(run, actor_id);
    if (!profile) return result("not_established");
    return result(profile.first_day_at_async ? "yes" : "no", { answer: { predicate: "person.first_day_at_async", polarity: profile.first_day_at_async ? "yes" : "no", band: profile.async_tenure }, statements: [profile.first_day_at_async ? "It's my first day." : `It's not my first day; ${TENURE_PHRASE[profile.async_tenure]}.`], provenance: ["self"], sources: ["member.personhood.first_day_at_async"] });
  },
  profile_tenure(run, { actor_id, args }) {
    if (!selfOnly(args, actor_id)) {
      const report = reportedAbout(run, actor_id, args.subject_id, "person.async_tenure") ?? reportedAbout(run, actor_id, args.subject_id, "person.first_day_at_async");
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) } });
    }
    const profile = personhood.profileOf(run, actor_id);
    if (!profile) return result("not_established");
    return result("value", { answer: { predicate: "person.async_tenure", band: profile.async_tenure, polarity: profile.async_tenure === "first_day" ? "no" : "yes" }, statements: [`${TENURE_PHRASE[profile.async_tenure].replace(/^./, (c) => c.toUpperCase())}.`], provenance: ["self"], sources: ["member.personhood.async_tenure"] });
  },
  profile_expedition_experience(run, { actor_id, args }) {
    if (!selfOnly(args, actor_id)) {
      const report = reportedAbout(run, actor_id, args.subject_id, "person.expedition_experience");
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) } });
    }
    const profile = personhood.profileOf(run, actor_id);
    if (!profile) return result("not_established");
    const none = profile.expedition_experience === "none";
    // "How many?" -- the profile holds a band, never a count: none is zero; otherwise the number is not established.
    if (args?.count_asked && !none) return result("not_established", { answer: { predicate: "person.expedition_experience", count_asked: true, band: profile.expedition_experience } });
    return result(none ? "no" : "yes", { answer: { predicate: "person.expedition_experience", polarity: none ? "no" : "yes", band: profile.expedition_experience, first_day: profile.first_day_at_async }, statements: [none ? "This is my first expedition." : "I've been on expeditions before."], provenance: ["self"], sources: ["member.personhood.expedition_experience"] });
  },
  profile_place_experience(run, { actor_id, args }) {
    const place = args?.place_id ?? "complex";
    if (!selfOnly(args, actor_id)) {
      const report = reportedAbout(run, actor_id, args.subject_id, "person.complex_experience");
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) } });
    }
    const profile = personhood.profileOf(run, actor_id);
    if (!profile) return result("not_established");
    const label = placeLabel(place);
    if (place === "complex" || place === "threshold") {
      const none = profile.complex_experience === "none";
      if (args?.count_asked && !none) return result("not_established", { answer: { predicate: "person.complex_experience", place, count_asked: true, band: profile.complex_experience } });
      return result(none ? "no" : "yes", { answer: { predicate: "person.complex_experience", place, polarity: none ? "no" : "yes", band: profile.complex_experience, first_day: profile.first_day_at_async }, statements: [none ? "I've never been in the Complex." : "I've been in the Complex before."], provenance: ["self"], sources: ["member.personhood.complex_experience"] });
    }
    if (COMPLEX_PLACES.has(place)) {
      // Never having entered the Complex settles every place inside it; having entered it settles none.
      if (profile.complex_experience === "none") return result("no", { answer: { predicate: "person.complex_experience", place, polarity: "no", band: "none" }, statements: [`I've never been to ${label}; I've never been in the Complex at all.`], provenance: ["self"], sources: ["member.personhood.complex_experience"] });
      return result("not_established", { answer: { predicate: "person.complex_experience", place, polarity: null }, statements: [], provenance: [] });
    }
    return result("not_established", { answer: { predicate: "person.complex_experience", place, polarity: null } });
  },
  profile_familiarity(run, { actor_id, args }) {
    // "Does Tonya know Malcolm?" asked of Giselle: someone else's acquaintance -- a heard report or unknown.
    if (!selfOnly(args, actor_id)) {
      // Only a report about THIS pair counts ("Tonya said she'd only met Maxwell today" says nothing of Malcolm).
      const report = canonicalKnowledge.heardPropositions(run, actor_id).filter((p) => p.speaker_id === args.subject_id && p.predicate === "person.familiarity" && (!args.other_id || p.other_id === args.other_id)).at(-1) ?? null;
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) } });
    }
    const profile = personhood.profileOf(run, actor_id);
    const other = args?.other_id ?? null;
    if (!profile) return result("not_established");
    if (!other) {
      // "Do you two know each other?": the speaker's familiarity with the others addressed.
      const bands = [...new Set((args?.others ?? []).map((id) => profile.familiarity?.[id]).filter(Boolean))];
      if (!bands.length) return result("not_established");
      const justMet = bands.every((b) => b === "just_met");
      return result(justMet ? "no" : "yes", { answer: { predicate: "person.familiarity", polarity: justMet ? "no" : "yes", band: bands[0], others: args?.others ?? [] }, statements: [justMet ? "We only met today." : "We know each other."], provenance: ["self"], sources: ["member.personhood.familiarity"] });
    }
    const band = profile.familiarity?.[other] ?? null;
    if (!band) return result("not_established");
    const name = nameOf(run, other, actor_id);
    return result(band === "just_met" ? "no" : "yes", { answer: { predicate: "person.familiarity", polarity: band === "just_met" ? "no" : "yes", band, other_id: other }, statements: [band === "just_met" ? `I only met ${name} today.` : `I know ${name}.`], provenance: ["self"], sources: ["member.personhood.familiarity"] });
  },
  claim_check() {
    // Whether something said is true is canonical fact, not conversation: without a grant that settles it
    // the honest answer is that the speaker can't say (never a yes from repetition or confidence).
    return result("unknown", { answer: { predicate: "conversation.claim_check", unverified: true }, provenance: [] });
  },
  profile_intent(run, { actor_id }) {
    // C6 need/goal read interface: no goal state is modelled yet, so this is honestly not established.
    const concern = require("./dialogue-agents").currentConcern(run, actor_id);
    if (concern.status !== "not_established") return result("not_established", { answer: { predicate: "person.intent", subject_id: actor_id, reason: "concern_interface_unwired" } });
    return result("not_established", { answer: { predicate: "person.intent", subject_id: actor_id, reason: concern.reason } });
  },
  self_state(run, { actor_id, args, temporal }) {
    if (!selfOnly(args, actor_id)) {
      const report = reportedAbout(run, actor_id, args.subject_id, args.predicate ?? "person.wellbeing");
      return report ? result("value", { answer: { reported: true, speaker_id: report.speaker_id, speaker_name: report.speaker_name ?? null, at: report.at }, statements: [`${report.speaker_name ?? "They"} said ${report.reported}`], provenance: ["heard"], sources: [report.source_ref] }) : result("unknown", { answer: { third_party: true, subject_name: nameOf(run, args.subject_id, actor_id) } });
    }
    const member = memberOf(run, actor_id);
    // Earlier with no recorded change since the day began: the day's baseline is how they were.
    const dims = temporal === "earlier" ? (personhood.selfStateAt(member, null) ?? personhood.selfStateDimensions(member)) : personhood.selfStateDimensions(member);
    return result("value", { answer: { dimensions: dims ?? null, temporal: temporal ?? "now" }, provenance: ["self"], sources: [temporal === "earlier" ? "member.personhood.self_state_history" : "member.emotional_state + personhood.baseline"] });
  },
  mission_destination(run, { actor_id }) {
    const grants = grantsOf(run, actor_id);
    const outpost = grants.find((g) => g.key === "outpost_destination") ?? grants.find((g) => g.key === "startup_material_destination");
    const next = grants.find((g) => g.key === "next_destination");
    const places = [];
    const statements = [];
    if (outpost) { places.push("outpost-a"); statements.push(`Maxwell said the startup materials are going to ${outpostLabel(outpost)}; that's the delivery.`); }
    if (next) { const staging = next.entity_id ?? "equipment-staging"; places.push(staging); statements.push(`Right after this we report to ${placeLabel(staging)}.`); }
    if (!places.length) return result("unknown", { answer: { predicate: "mission.destination", places: [] } });
    return result("value", { answer: { predicate: "mission.destination", places, immediate: next ? (next.entity_id ?? "equipment-staging") : null, delivery: outpost ? "outpost-a" : null }, statements, provenance: [...new Set([outpost, next].filter(Boolean).map((g) => g.provenance))], sources: [outpost?.source_ref, next?.source_ref].filter(Boolean) });
  },
  mission_schedule(run, { actor_id }) {
    const schedule = grantsOf(run, actor_id).find((g) => g.concept === "schedule");
    if (!schedule) {
      // The speaker's own canonical observation record may hold the schedule (non-opener scenarios).
      const observed = observedTopicFacts(run, actor_id, "time_or_schedule");
      if (observed.length) return result("value", { answer: { predicate: "mission.schedule", window: null }, statements: observed.slice(0, 2), provenance: ["observed"], sources: ["member.known_information (direct-observation)"] });
      return result("unknown", { answer: { predicate: "mission.schedule" } });
    }
    return result("value", { answer: { predicate: "mission.schedule", window: run?.expedition?.mission?.operational_window ?? null }, statements: [schedule.proposition], provenance: [schedule.provenance], sources: [schedule.source_ref] });
  },
  mission_route(run, { actor_id }) {
    const tape = grantsOf(run, actor_id).find((g) => g.key === "guidance_tape");
    if (!tape) {
      const observed = observedTopicFacts(run, actor_id, "route_or_navigation");
      if (observed.length) return result("value", { answer: { predicate: "mission.route", form: "observed" }, statements: observed.slice(0, 2), provenance: ["observed"], sources: ["member.known_information (direct-observation)"] });
      return result("not_established", { answer: { predicate: "mission.route" } });
    }
    return result("partial", { answer: { predicate: "mission.route", form: "guidance_tape", missing: "todays_route" }, statements: [tape.proposition, "Nobody's told me the exact route beyond that."], provenance: [tape.provenance], sources: [tape.source_ref] });
  },
  place_access(run, { actor_id, args }) {
    const place = args?.place_id ?? "complex";
    // Going into the Complex is what the expedition is assigned to do (baseline induction); nothing more.
    const assigned = grantsOf(run, actor_id).find((g) => g.key === "expedition_assignment");
    if (!COMPLEX_PLACES.has(place) || !assigned) return result("not_established", { answer: { predicate: "place.access", place } });
    return result("yes", { answer: { predicate: "place.access", place, polarity: "yes" }, statements: ["We're assigned to an expedition into the Complex."], provenance: [assigned.provenance], sources: [assigned.source_ref] });
  },
  transition_participants(run, { actor_id, args }) {
    const grants = grantsOf(run, actor_id);
    const dismissal = grants.find((g) => g.key === "dismissal_instruction");
    const roster = grants.filter((g) => g.key === "briefed_assignment");
    const place = args?.place_id ?? null;
    const toMission = place && COMPLEX_PLACES.has(place);
    const members = (run?.expedition?.team?.members ?? []).map(idOf);
    const playerId = run?.session?.startup?.player?.observer_id ?? null;
    if (toMission) {
      // The roster call assigned every person at the table a role on today's expedition.
      if (!roster.length) return result("unknown", { answer: { predicate: "transition.participants", place, participants: null } });
      const assigned = [...new Set(roster.map((g) => g.entity_id).filter(Boolean))];
      const everyone = members.every((id) => assigned.includes(id));
      return result(everyone ? "yes" : "partial", { answer: { predicate: "transition.participants", place, participants: assigned, everyone, subject_ids: args?.subject_ids ?? null }, statements: [everyone ? "Maxwell gave every one of us a job on this expedition, so as far as I know we're all going." : "Maxwell gave some of us jobs on this expedition."], provenance: ["briefing"], sources: roster.map((g) => g.source_ref) });
    }
    // The next move (Equipment Staging): the dismissal told everyone at the table to report there.
    if (!dismissal) return result("unknown", { answer: { predicate: "transition.participants", place: place ?? "equipment-staging", participants: null } });
    const destination = dismissal.proposition.match(/report to ([A-Z][\w ]+?)\.?$/)?.[1] ?? "Equipment Staging";
    const listeners = canonicalKnowledge.deliveredBriefing(run).find((b) => b.key === "dismissal")?.listeners ?? members;
    const everyone = members.every((id) => listeners.includes(id) || id === playerId);
    return result(everyone ? "yes" : "partial", { answer: { predicate: "transition.participants", place: place ?? "equipment-staging", participants: members, everyone, subject_ids: args?.subject_ids ?? null, destination }, statements: [`Maxwell told all of us to report to ${destination}.`], provenance: ["briefing"], sources: [dismissal.source_ref] });
  }
};

/** The actor's own direct observations on a topic (the canonical known_information record). */
function observedTopicFacts(run, actorId, topic) {
  const { detectTopic } = require("./dialogue-interpretation");
  return (memberOf(run, actorId)?.known_information ?? []).filter((f) => f?.text && (f.kind !== "reported-knowledge" || f.source === "direct-observation") && detectTopic(String(f.text)) === topic).map((f) => String(f.text));
}

function placeLabel(id) {
  const location = canonLexicon.CANONICAL_LOCATIONS?.[id];
  if (location) return location.display_name;
  const entity = canonLexicon.CANONICAL_ENTITIES?.[id];
  if (entity) return entity.display_name;
  return id === "outpost-a" ? "Outpost A" : id === "complex" ? "the Complex" : id;
}
function outpostLabel(grant) { return grant?.proposition?.match(/(Outpost A[^.;]*)/)?.[1]?.trim() ?? "Outpost A"; }
function nameOf(run, id, actorId) {
  if (id === run?.session?.startup?.player?.observer_id) return "you";
  if (id === actorId) return "me";
  const member = memberOf(run, id);
  if (member) return member.first_name ?? member.display_name ?? "them";
  const authority = run?.expedition?.mission?.briefing_authority;
  return authority && (authority.identity ?? "dr-kirk-maxwell") === id ? "Maxwell" : "them";
}

/** Adds a resolver (a lore facet = registry entry + this function). */
function registerResolver(name, fn) {
  if (typeof fn !== "function") throw new Error("resolver must be a function");
  RESOLVERS[name] = fn;
}
function unregisterResolver(name) { delete RESOLVERS[name]; }

function resolvePredicate(run, { actor_id, predicate, args = {}, temporal = null, registry = null } = {}) {
  const entry = registry ?? require("./dialogue-registry").get(predicate);
  if (!entry?.resolver) return result("not_established", { answer: { predicate, reason: "no_resolver" } });
  const fn = RESOLVERS[entry.resolver];
  if (!fn) return result("not_established", { answer: { predicate, reason: "resolver_missing" } });
  const out = fn(run, { actor_id, predicate, args: { ...args, predicate }, temporal });
  return Object.freeze({ ...out, predicate, resolver: entry.resolver });
}

module.exports = { RESOLVER_VERSION, RESOLVERS, TENURE_PHRASE, COMPLEX_PLACES, resolvePredicate, registerResolver, unregisterResolver, placeLabel };
