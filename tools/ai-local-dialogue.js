"use strict";

// LOCAL language generation is presentation-only. Personnel continuity
// decides whether a particular coworker responds before this packet exists;
// the provider may only phrase that already-authorized response.
const canonicalLedger = require("./canonical-world-ledger");
const { projectLiveScene, projectObserverState } = require("./live-scene-projection");
const { isParticipantOrListener, heardInitiatingUtterance, heardResponseUtterance, getAttitude, retrieveRelevantMemories } = require("./q4-personnel-continuity");
const { interpretUtterance, resolveResponsePurpose, selectRelevantContext, resolveReportPurpose, detectTopic } = require("./dialogue-interpretation");
const { IDENTITY_STYLE_KEYS, buildAutonomousContribution } = require("./dialogue-discourse");
const { compileObserverDialogueContext, describeCapsule } = require("./observer-context-compiler");
const { validateUniversalWording, validateContribution, validateOwnershipClaims, contentWords, sameStem, coverage } = require("./dialogue-validation");

// Discourse functions whose model context is structurally reduced to the
// authorized contribution: no memories, recent dialogue, known facts, task,
// equipment, qualifications, visible objects or shell. The only history such a
// turn carries is the contribution's own antecedent.
const CONTAINED_FUNCTIONS = new Set(["clarify_previous", "request_repetition", "ambiguous_reference", "invite_self_description", "greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "check_in", "close_topic", "ask_role_or_assignment", "ask_item_ownership"]);

const PACKET_VERSION = "yellow-beast-local-dialogue-packet@v1";
const CANDIDATE_VERSION = "yellow-beast-local-dialogue-candidate@v1";
const REPORT_PACKET_VERSION = "yellow-beast-observation-report-packet@v1";
const FORBIDDEN_METADATA = /\b(?:canonical[_ -]?geometry|euclidean[_ -]?relation|overlap[_ -]?depth|future[_ -]?(?:event|schedule)|random[_ -]?seed|provider[_ -]?(?:model|metadata|prompt)|migration|debug|semantic[_ -]?(?:id|identifier)|canonical[_ -]?(?:family|type))\b/i;
const FORBIDDEN_INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;
const INVENTED_PLAYER = /\byou (?:say|said|speak|spoke|ask|asked|reply|replied|answer|answered|decide|decided|realize|realized|conclude|concluded|notice|noticed|walk|walked|run|ran|move|moved|arrive|arrived|turn|turned|reach|reached|inspect|inspected|measure|measured|photograph|photographed|take|took|use|used)\b/i;
const UNSUPPORTED_FACTUAL_SPEECH = /\b(?:there (?:is|are|'s)|i (?:know|served|worked|was stationed|have been)|we (?:know|mapped|confirmed)|the (?:exit|route|door|passage|room|corridor) (?:is|leads|goes|opens)|(?:will|going to) (?:happen|arrive|open|close))\b/i;

// First-person custody wording, used only for the contribution's holder fact.
// Item identity and custody claim parsing live in dialogue-validation.

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function getRecentDialogue(expedition, playerId, speakerId, limit = 6, pendingInteractionId = null) {
  if (!expedition?.interaction_history) return [];
  const results = [];
  for (const entry of expedition.interaction_history) {
    // The current player message has its own packet field. Its provisional
    // fallback must not masquerade as an already delivered coworker reply.
    if (pendingInteractionId && entry.id === pendingInteractionId) continue;
    if (entry.channel !== "local") continue;
    const heardInit = heardInitiatingUtterance(entry, speakerId);
    const heardResp = heardResponseUtterance(entry, speakerId);
    if (!heardInit && !heardResp) continue;

    // A committed group turn may carry several responders in
    // entry.responses[] (canonical owner order). Represent each committed
    // response as its own row rather than collapsing to the first one, so a
    // later responder can see the full heard exchange, not just one line of
    // it. The player utterance is attached once, to the first row, so it is
    // never duplicated across responder rows.
    const committed = heardResp && Array.isArray(entry.responses) && entry.responses.length > 0
      ? entry.responses
      : null;
    if (committed) {
      committed.forEach((item, index) => {
        results.push({
          id: entry.id,
          player_text: index === 0 && heardInit ? (entry.player_text ?? null) : null,
          response: item.text ?? null,
          speaker: item.speaker_name ?? null
        });
      });
    } else {
      results.push({
        id: entry.id,
        player_text: heardInit ? (entry.player_text ?? null) : null,
        response: heardResp ? (entry.presentation?.response ?? entry.response ?? null) : null,
        speaker: heardResp ? (entry.response_speaker ?? null) : null
      });
    }
  }
  return results.slice(-limit);
}

function buildLocalDialoguePacket(context) {
  const { run, player_text, speaker, person, reaction_context, reaction, interpretation: suppliedInterpretation } = context;
  const playerId = run.session.startup.player.observer_id;
  const speakerId = speaker.personnel_id ?? speaker.id;
  const isGroup = context.is_group ?? false;

  // ── 1. Bounded interpretation (prefer supplied; derive if absent) ──────
  const interpretation = (suppliedInterpretation?.version)
    ? suppliedInterpretation
    : interpretUtterance(String(player_text ?? "").trim(), { isGroup });

  // ── 2. Response purpose — deterministic, not left to the model ─────────
  // ED-1: a code-built response plan owns the purpose when present; the
  // speech-act default remains for callers that supply no plan.
  // Already-ACCEPTED same-turn wording (names + text only, never ids). It lives
  // inside the contribution: the single model-visible authority for it.
  const acceptedPrior = (Array.isArray(context.same_turn_prior_responses) ? context.same_turn_prior_responses : [])
    .filter((item) => item?.text)
    .map((item) => ({ speaker_name: item.speaker_name ?? null, text: item.text }));
  const contribution = context.authorized_contribution ? { ...context.authorized_contribution, same_turn_prior_responses: acceptedPrior } : null;
  const contained = Boolean(contribution && CONTAINED_FUNCTIONS.has(contribution.discourse_function));
  // Plan-carrying factual/personal/other turns: the plan supplies every fact, so
  // unscored memory bags, shared history, the speaker shell and visible objects
  // are structurally absent; only a short recent-dialogue tail survives, and only
  // for functions that continue a conversation.
  const lean = Boolean(contribution) && !contained;
  const TAIL_FUNCTIONS = new Set(["challenge", "make_request", "make_statement", "express_uncertainty"]);
  const response_purpose = contribution?.purpose ?? resolveResponsePurpose(interpretation, reaction?.category ?? "acknowledgment");

  // ── 3. Observer projections ────────────────────────────────────────────
  const speakerProjected = projectObserverState(run, speakerId, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  const playerProjected = projectLiveScene(run, { observer_id: playerId });
  if (!playerProjected.ok) throw new Error(playerProjected.error?.code ?? "PLAYER_LIVE_SCENE_UNAVAILABLE");
  const visibleSpeaker = playerProjected.packet.visible_personnel.find((item) => item.observer_id === speakerId);
  if (!visibleSpeaker) throw new Error("LOCAL_SPEAKER_NOT_VISIBLE");

  // ── 4. Memory / fact retrieval with relevance filtering ───────────────
  const publicContinuity = person?.continuity ?? {};
  const recentAll = contained ? [] : getRecentDialogue(run.expedition, playerId, speakerId, 6, context.interaction?.id);
  // Legacy (no-plan) callers keep the broad tail; plan-carrying packets never
  // expose it as a bag: rows reach the model only through the contribution.
  const recentDialogue = contribution ? [] : recentAll;

  const rawRelevantMemories = contained ? [] : retrieveRelevantMemories(person, run.expedition, {
    queryText: player_text,
    speakerId,
    playerId,
    limit: 5,
    excludeRecent: recentAll
  });

  const knownFacts = (speaker.known_information ?? []).filter((f) => f.kind !== "reported-knowledge" || f.source === "direct-observation");
  const selected = selectRelevantContext(interpretation, rawRelevantMemories, knownFacts);
  const { relevant_memories, forbidden_topics } = selected;
  // Structural fact containment: with an authorized contribution the model's
  // facts are exactly the plan's known_fact entries, never whatever the
  // speaker happens to know.
  // Facts live ONLY in the contribution (required/optional facts); a duplicate
  // top-level known_facts surface would be a second fact authority.
  const relevant_facts = contribution ? [] : selected.relevant_facts;

  // Deterministic relevance relation for history/memory rows in plan-carrying
  // packets: a row survives only if it shares the frame's (known) topic or a
  // resolved referent's words, or it is one of the last two rows of an
  // exchange-continuing function. Everything else is omitted.
  if (contribution) {
    const topic = contribution.topic ?? "unknown";
    const referentWords = (contribution.referents ?? []).flatMap((ref) => contentWords(ref.label ?? ""));
    const relevantRow = (row) => {
      const text = `${row.player_text ?? ""} ${row.response ?? ""}`;
      if (topic !== "unknown" && detectTopic(text) === topic) return true;
      const spoken = contentWords(text);
      return referentWords.some((w) => spoken.some((x) => sameStem(w, x)));
    };
    const tail = TAIL_FUNCTIONS.has(contribution.discourse_function) ? recentAll.slice(-2) : [];
    const rows = lean ? [...new Set([...recentAll.filter(relevantRow), ...tail])] : [];
    contribution.recent_context = rows.slice(-4).map((row) => ({ player_text: row.player_text ?? null, response: row.response ?? null, speaker: row.speaker ?? null }));
    contribution.relevant_memories = lean ? relevant_memories.filter(relevantRow).slice(0, 2).map((rm) => ({ player_text: rm.player_text ?? null, response: rm.response ?? null })) : [];
  }

  // ── 5. Combine memories (relevant first, then recent base) ────────────
  const baseMemories = ((contained || lean) ? [] : (person?.continuity?.dialogue_memories ?? []).slice(-6)).map((m) => ({
    player_text: m.player_text,
    response: m.response,
    sender: m.sender
  }));

  const memoryMap = new Map();
  for (const rm of relevant_memories) {
    const key = rm.id || `${rm.player_text}:${rm.response}`;
    memoryMap.set(key, {
      player_text: rm.player_text,
      response: rm.response,
      sender: rm.sender ?? rm.speaker,
      relevance: "explicit-query-match"
    });
  }
  for (const bm of baseMemories) {
    const key = bm.id || `${bm.player_text}:${bm.response}`;
    if (!memoryMap.has(key)) memoryMap.set(key, bm);
  }
  const combinedMemories = [...memoryMap.values()];

  // ── 6. Relationship ───────────────────────────────────────────────────
  const attitude = getAttitude(person, playerId);
  const relationship = attitude ? {
    trust: attitude.trust,
    rapport: attitude.rapport,
    disposition: attitude.disposition,
    sentiment: attitude.sentiment,
    recent_attribution: attitude.attributions?.at(-1)?.reason ?? null
  } : null;

  // ── 7. Assemble the model-facing packet ───────────────────────────────
  // INVARIANT: Raw run object MUST NOT appear in any enumerable field.
  // _run is strictly non-enumerable and used only by validators.

  // Social speech acts receive a reduced operational context. The model only
  // needs speaker identity and the social situation; visible objects, held
  // equipment, current task, and qualifications anchor responses to factual
  // content and are inappropriate for purely social exchanges.
  const noShell = Boolean(contribution);
  const isSocialAct = contained || ["joke_or_sarcasm", "greeting", "introduction", "acknowledgment", "social_observation"].includes(interpretation.speech_act);
  // Identity: STYLE keys only. Factual identity fields reach the model solely
  // as plan-authorized facts inside authorized_contribution.
  const identityStyle = contribution
    ? { ...(contribution.style_hints ?? {}) }
    : Object.fromEntries(IDENTITY_STYLE_KEYS.filter((key) => person?.identity_substrate?.[key] != null).map((key) => [key, person.identity_substrate[key]]));

  // ── 6b. Observer-safe live context (the ONE bridge) ───────────────────
  // Rebuilt from CURRENT canonical state for this generation; carries only what
  // this speaker can know. The model-facing renderer reads this and the
  // contribution, never the run.
  const capsule = contribution ? compileObserverDialogueContext({
    run,
    speakerId,
    listeners: context.interaction?.listeners ?? [],
    recipientContext: { recipient_type: context.recipient_type ?? (isGroup ? "group" : "direct"), target_id: (context.recipient_type ?? (isGroup ? "group" : "direct")) === "direct" ? speakerId : null, inherited_scope: Boolean(context.inherited_scope) },
    semanticFrame: context.semantic_frame ?? null,
    responsePlan: context.response_plan ?? null,
    contribution,
    submissionId: context.requestId ?? null,
    pendingInteractionId: context.interaction?.id ?? null,
    phaseId: context.phase_id ?? null,
    utterance: String(player_text ?? "").trim(),
    purpose: "response"
  }) : null;

  const packet = {
    version: PACKET_VERSION,
    audience: "controlled-player",
    authority_contract: {
      presentation: "candidate-only",
      response_authorization: "personnel-continuity-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    player_message: {
      text: String(player_text ?? "").trim().slice(0, 2000),
      state: "delivered",
      channel: "LOCAL"
    },
    // ── Bounded interpretation (model is told what kind of exchange this is) ──
    player_speech_act: {
      speech_act: interpretation.speech_act,
      topic: interpretation.topic,
      tone: interpretation.tone,
      literal_question: interpretation.literal_question,
      confidence: interpretation.confidence
    },
    speaker: {
      observer_id: speakerId,
      known_identity: visibleSpeaker.known_identity,
      // With a contribution, role is a fact only when the plan supplies it.
      role: contribution ? null : visibleSpeaker.role_if_known,
      visible_condition: visibleSpeaker.visible_condition,
      // Operational task/equipment/qualifications suppressed for social acts
      // to prevent the model from converting social remarks into briefings.
      current_task: (isSocialAct || contribution) ? null : (reaction_context?.worker?.task ?? null),
      held_equipment: (isSocialAct || contribution) ? [] : (reaction_context?.equipment ?? []),
      qualifications: (isSocialAct || contribution) ? [] : (reaction_context?.worker?.qualifications ?? []),
      // Plan-carrying packets: character shaping is bounded STYLE only. No
      // personality/archetype labels, tendencies, relationship prose or
      // attribution: those read as factual biography ("first time for me").
      characterization: contribution
        ? { style: identityStyle }
        : {
            archetype: person?.archetype ?? null,
            personality: person?.personality ?? null,
            primary_task: person?.primary_task ?? null,
            style: identityStyle
          },
      tendencies: contribution ? {} : (person?.continuity?.tendencies ?? reaction_context?.worker?.tendencies ?? {}),
      relationship: contribution ? null : relationship,
      memories: contribution ? [] : combinedMemories,
      relevant_memories: (contribution ? [] : relevant_memories).map((rm) => ({
        player_text: rm.player_text,
        response: rm.response,
        sender: rm.sender ?? rm.speaker,
        at: rm.at
      })),
      recent_dialogue: recentDialogue,
      shared_history: ((contained || lean) ? [] : (publicContinuity.shared_history ?? []))
        .filter((item) => item.participants?.includes(playerId))
        .slice(-4)
        .map((item) => ({ kind: item.kind }))
    },
    // ── Relevant known facts (pre-filtered by selectRelevantContext) ──────
    known_facts: relevant_facts.map((f) => ({
      kind: f.kind ?? "reported-knowledge",
      text: String(f.text ?? "").slice(0, 400)
    })),
    // ── Topics excluded from this response (model must not invent these) ──
    forbidden_knowledge: forbidden_topics.length > 0 ? forbidden_topics : null,
    // Legacy callers without a response plan keep the top-level copy; with a
    // contribution the same wording is carried ONLY inside it.
    ...(contribution ? {} : {
      same_turn_prior_responses: acceptedPrior
    }),
    visible_context: {
      location: speakerProjected.packet.physical.location,
      environment: contribution ? null : playerProjected.packet.visible_environment,
      // Visible objects suppressed for social acts: the object list provides
      // operational texture that is irrelevant to social exchanges and can
      // anchor the model to equipment/fixture details inappropriately.
      visible_objects: (isSocialAct || noShell) ? [] : speakerProjected.packet.physical.visible_objects
    },
    // speaker_shell elided for social acts (it duplicates the reduced speaker
    // block and carries the full visible object list). Preserved for informational
    // acts where the model may need location and equipment provenance detail.
    speaker_shell: (isSocialAct || noShell) ? null : speakerProjected.packet,
    authorized_response: {
      category: reaction?.category ?? "acknowledgment",
      purpose: response_purpose,
      new_factual_claims: "forbidden"
    },
    // Observer-safe live context (compiled fresh for this generation).
    context_capsule: capsule ? JSON.parse(JSON.stringify(capsule)) : null,
    // Bounded, code-authorized plan the model must word. Present for every
    // turn built with a response plan.
    authorized_contribution: contribution
  };

  const cloned = structuredClone(packet);

  // _run is non-enumerable — never serialized, never JSON.stringify'd,
  // never visible to the model. Used only by validateLocalDialogue.
  Object.defineProperty(cloned, "_run", { configurable: true, enumerable: false, value: run });

  // The compiled capsule WITH its internal provenance/stamps: validators and the
  // pre-commit revalidation only. Non-enumerable, so it never reaches a provider.
  Object.defineProperty(cloned, "_capsule", { configurable: true, enumerable: false, value: capsule });

  // Same-turn wording with ids, for traces only; never model-facing.
  Object.defineProperty(cloned, "_same_turn_prior_responses", { configurable: true, enumerable: false, value: (context.same_turn_prior_responses ?? []).map((item) => ({ speaker_id: item.speaker_id ?? null, speaker_name: item.speaker_name ?? null, text: item.text ?? null })) });
  // Internal plan (owner id etc.) for validators only; never model-facing.
  Object.defineProperty(cloned, "_response_plan", { configurable: true, enumerable: false, value: context.response_plan ? structuredClone(context.response_plan) : null });

  // _dialogue_trace is non-enumerable, dev-only context for pipeline introspection.
  Object.defineProperty(cloned, "_dialogue_trace", {
    configurable: true,
    enumerable: false,
    value: Object.freeze({
      raw_utterance: String(player_text ?? "").trim(),
      interpretation: { ...interpretation },
      response_purpose,
      semantic_frame: context.semantic_frame ?? null,
      response_plan: context.response_plan ?? null,
      forbidden_topics,
      relevant_facts_count: relevant_facts.length,
      relevant_memories_count: relevant_memories.length,
      reaction_category: reaction?.category ?? null,
      context: capsule ? describeCapsule(capsule) : null
    })
  });

  return deepFreeze(cloned);
}

// Sibling of buildLocalDialoguePacket for an autonomous NPC observation
// report. Deliberately separate: the player-response packet requires
// player_text and throws when the player cannot see the speaker, but an
// autonomous report may legitimately be spoken with the player absent or
// elsewhere. Everything the report says is authorized before this packet is
// built (speech-scheduler.js's queue entry) -- the model only wordsmiths it.
function buildObservationReportPacket(context) {
  const { run, observer_id, feature_id, purpose, disposition } = context;
  const member = canonicalLedger.getObserverMember(run, observer_id);
  const speakerProjected = projectObserverState(run, observer_id, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  const obsEntry = run.observation_state?.observers?.[observer_id]?.features?.[feature_id] ?? null;
  const kind = String(feature_id).split(":")[0];
  const canonicalId = String(feature_id).slice(kind.length + 1);

  const playerId = run.session?.startup?.player?.observer_id ?? null;
  // The plan is the ONLY semantic authority; a raw heard-history tail and the
  // scene's object list stay structurally absent from a plan-carrying packet.
  const contribution = buildAutonomousContribution({ kind, canonical_id: canonicalId, state: obsEntry?.state ?? "RECOGNIZED", purpose, disposition, identity_substrate: run._world?.characters?.[observer_id]?.identity_substrate ?? null });

  const capsule = compileObserverDialogueContext({ run, speakerId: observer_id, contribution, purpose: "autonomous_report", observation: { feature_id }, phaseId: context.phase_id ?? null });

  const packet = {
    version: REPORT_PACKET_VERSION,
    audience: "autonomous-npc-report",
    authority_contract: {
      presentation: "candidate-only",
      report_authorization: "speech-scheduler-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    speaker: {
      observer_id,
      known_identity: member?.first_name ?? member?.display_name ?? null,
      role: member?.role ?? null
    },
    channel: "LOCAL",
    physical_situation: {
      location: speakerProjected.packet.physical.location,
      visible_objects: []
    },
    authorized_observation: {
      kind,
      subject: canonicalId,
      state: obsEntry?.state ?? "RECOGNIZED",
      recognized_via: obsEntry?.recognition?.qualification ?? null
    },
    report_purpose: {
      purpose,
      disposition,
      wording_instruction: resolveReportPurpose(purpose)
    },
    heard_history: [],
    context_capsule: JSON.parse(JSON.stringify(capsule)),
    authorized_contribution: contribution,
    forbidden_knowledge: ["canonical_geometry", "future_events", "other_observers_private_state", "provider_metadata"]
  };

  const cloned = structuredClone(packet);
  Object.defineProperty(cloned, "_run", { configurable: true, enumerable: false, value: run });
  Object.defineProperty(cloned, "_capsule", { configurable: true, enumerable: false, value: capsule });
  return deepFreeze(cloned);
}

function samePersonnel(id1, id2) {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true;
  return id1 === `personnel-${id2}` || id2 === `personnel-${id1}`;
}

function validateDialogueClaims(packet, candidate, run) {
  if (!run || !candidate?.speech) return { ok: true };
  const speakerId = packet.speaker?.observer_id;
  const speech = candidate.speech;

  // 1. Validate equipment custody claims: per-claim subject parsing, item
  // identity from the canonical resolver (dialogue-validation).
  const custody = validateOwnershipClaims(speech, { run, speakerId });
  if (!custody.ok) return custody;

  // 2. Validate unobserved event claims
  const directObs = canonicalLedger.getObserverObservations(run, speakerId);
  const reportedKnowledge = canonicalLedger.getObserverReportedKnowledge(run, speakerId);

  const sawMatch = speech.match(/\b(?:i saw|i inspected|i observed|i checked|i noticed)\b.{1,35}\b(fixture|fluorescent fixture|scuff|scuff mark|distortion|seam|door|stair|grade|passage|offset)\b/i);
  if (sawMatch) {
    const target = sawMatch[1].toLowerCase();
    const hasObserved = directObs.some((item) => String(item.target ?? "").toLowerCase().includes(target));
    const isCurrentlyVisible = (packet.visible_context?.visible_objects ?? []).some((obj) => String(obj.name ?? "").toLowerCase().includes(target));
    if (!hasObserved && !isCurrentlyVisible) {
      return {
        ok: false,
        code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
        reason: `Speaker ${speakerId} claimed direct observation of ${target} without prior direct observation or current visibility.`
      };
    }
  }

  const eventMatch = speech.match(/\b(?:photographed|measured|reading of|offset of|depth of)\b.{0,30}\b(fixture|fluorescent fixture|passage|corridor)\b/i);
  if (eventMatch) {
    const term = eventMatch[1].toLowerCase();
    const hasDirect = directObs.some((item) => String(item.target ?? "").toLowerCase().includes(term));
    const hasReported = reportedKnowledge.some((item) => String(item.text ?? "").toLowerCase().includes(term));
    if (!hasDirect && !hasReported) {
      return {
        ok: false,
        code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
        reason: `Speaker ${speakerId} referenced ${term} outcome without direct observation or reported knowledge.`
      };
    }
  }

  return { ok: true };
}

function validateSemanticClaims(claims, speakerId, run) {
  if (!Array.isArray(claims)) {
    return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "Claims must be an array" };
  }
  if (claims.length > 8) {
    return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "At most eight claims are permitted" };
  }
  const allowedTypes = new Set(["equipment-possession", "equipment_possession", "location", "direct-observation", "direct_observation", "reported-claim", "reported-observation", "reported_claim", "measurement"]);
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") {
      return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "Each claim must be an object" };
    }
    const type = claim.type ?? claim.kind;
    const subject = claim.subject ?? claim.observer ?? speakerId;
    if (!allowedTypes.has(type)) {
      return { ok: false, code: "SEMANTIC_CLAIM_TYPE_UNSUPPORTED", claim, reason: `Unsupported semantic claim type: ${type ?? "missing"}.` };
    }

    if (type === "equipment-possession" || type === "equipment_possession") {
      const item = claim.object ?? claim.item_id ?? claim.equipment;
      const canonicalHolder = canonicalLedger.getEquipmentHolder(run, item);
      if (!canonicalHolder || !samePersonnel(canonicalHolder, subject)) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_EQUIPMENT_MISMATCH",
          claim,
          reason: `Subject ${subject} does not hold ${item}; actual holder is ${canonicalHolder ?? "none"}.`
        };
      }
    } else if (type === "location") {
      const targetLoc = claim.location_id ?? claim.location;
      const actualLoc = canonicalLedger.getPersonnelLocation(run, subject);
      if (actualLoc !== targetLoc) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_LOCATION_MISMATCH",
          claim,
          reason: `Subject ${subject} is at ${actualLoc}, not ${targetLoc}.`
        };
      }
    } else if (type === "direct-observation" || type === "direct_observation") {
      const target = claim.target;
      const hasObserved = canonicalLedger.hasObserverObserved(run, subject, target);
      let isVisible = false;
      try {
        const liveScene = projectLiveScene(run, { observer_id: subject });
        if (liveScene.ok) {
          isVisible = (liveScene.packet.visible_objects ?? []).some((obj) =>
            String(obj.name ?? "").toLowerCase().includes(String(target).toLowerCase())
          );
        }
      } catch {}
      if (!hasObserved && !isVisible) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNOBSERVED_TARGET",
          claim,
          reason: `Observer ${subject} has no direct observation provenance for ${target}.`
        };
      }
    } else if (type === "reported-claim" || type === "reported-observation" || type === "reported_claim") {
      const prop = claim.proposition ?? claim.target;
      const reportedKnowledge = canonicalLedger.getObserverReportedKnowledge(run, subject);
      const matches = reportedKnowledge.some((item) =>
        String(item.proposition ?? item.text ?? "").toLowerCase().includes(String(prop).toLowerCase())
      );
      if (!matches) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNREPORTED_TARGET",
          claim,
          reason: `Observer ${subject} has no reported knowledge provenance for ${prop}.`
        };
      }
    } else if (type === "measurement") {
      const target = claim.target ?? claim.evidence_id;
      const evidenceList = run.expedition?.evidence ?? [];
      const hasMeasurement = evidenceList.some((e) =>
        e.valid === true &&
        e.measurement &&
        (e.id === target || String(e.source_location_name ?? "").toLowerCase().includes(String(target).toLowerCase()) || String(e.type ?? "").toLowerCase().includes(String(target).toLowerCase()))
      );
      if (!hasMeasurement) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNVERIFIED_MEASUREMENT",
          claim,
          reason: `Observer ${subject} has no verified measurement for ${target}.`
        };
      }
    }
  }

  return { ok: true, claims };
}

function claimCoversSpeech(claim, speech) {
  const normalizedSpeech = String(speech).toLowerCase();
  const quotedText = String(claim?.text ?? "").trim().toLowerCase();
  if (quotedText.length >= 4 && normalizedSpeech.includes(quotedText)) return true;
  const type = claim?.type ?? claim?.kind;
  const subjectText = type === "equipment-possession" || type === "equipment_possession"
    ? claim?.object ?? claim?.item_id ?? claim?.equipment
    : type === "location"
      ? claim?.location_id ?? claim?.location
      : type === "reported-claim" || type === "reported-observation" || type === "reported_claim"
        ? claim?.proposition ?? claim?.target
        : claim?.target ?? claim?.evidence_id;
  const normalizedSubject = String(subjectText ?? "").toLowerCase().replace(/[-_]+/g, " ").trim();
  return normalizedSubject.length >= 3 && normalizedSpeech.replace(/[-_]+/g, " ").includes(normalizedSubject);
}

// A line may mention another person only when the contribution or the player's own words already
// do. Context lists who is present so the speaker is oriented, not so it can name-drop or invent
// interactions with them ("I heard them too, Kristina.").
function validateNamedPeople(packet, speech) {
  const capsule = packet?.context_capsule;
  const contribution = packet?.authorized_contribution;
  if (!capsule || !contribution) return { ok: true };
  const allowed = JSON.stringify([contribution.required_facts, contribution.optional_facts, contribution.antecedent, contribution.same_turn_prior_responses]).toLowerCase();
  const said = String(packet.player_message?.text ?? "").toLowerCase();
  const self = String(capsule.actor?.name ?? "").toLowerCase();
  // A vocative ("Morning, Joe.") may name only someone the context or the player's own words supply:
  // inventing the name of the person spoken to is an invented fact.
  const known = new Set([self, ...(capsule.present_people ?? []).map((p) => String(p.name ?? "").toLowerCase()), ...(capsule.heard_turns ?? []).map((t) => String(t.speaker ?? "").toLowerCase())]);
  const NOT_NAMES = new Set(["everyone", "everybody", "all", "folks", "team", "guys", "gang", "there", "y'all", "friend", "friends", "boss", "chief", "lead", "sir", "ma'am", "player"]);
  for (const match of speech.matchAll(/\b(?:morning|afternoon|evening|hey|hi|hello|thanks|thank you|yeah|yes|sure|okay|ok|well|right|welcome|sorry),?\s+([A-Za-z]+)\b/gi)) {
    if (!/^[A-Z]/.test(match[1])) continue; // a capitalized word after the greeting is a name; lowercase words are not
    const name = match[1].toLowerCase();
    if (name === self) return { ok: false, code: "LOCAL_PRESENTATION_FORBIDDEN_CLAIM", reason: "addresses the person spoken to by the speaker's own name" };
    if (NOT_NAMES.has(name) || known.has(name) || said.includes(name) || allowed.includes(name)) continue;
    return { ok: false, code: "LOCAL_PRESENTATION_FORBIDDEN_CLAIM", reason: `addresses someone by a name the context does not supply: ${match[1]}` };
  }
  const names = new Set([...(capsule.present_people ?? []).filter((p) => !p.is_player).map((p) => p.name), ...(capsule.heard_turns ?? []).filter((t) => !t.is_player && !t.is_self).map((t) => t.speaker)]);
  for (const name of names) {
    const lower = String(name ?? "").toLowerCase();
    if (!lower || lower === self || lower === "someone") continue;
    if (new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(speech) && !allowed.includes(lower) && !said.includes(lower)) return { ok: false, code: "LOCAL_PRESENTATION_FORBIDDEN_CLAIM", reason: `mentions ${name}, whom the contribution does not mention` };
  }
  return { ok: true };
}

// Style/delivery is free; a NEW state is not. A first-person emotional or social claim (fear, anger,
// frustration, distrust, attachment...) is a substantive character state, so it must be established by
// the capsule's canonical human context (or already voiced by the player's own words). Dry colour such
// as "Yeah, very reassuring." claims no state and passes.
const EMOTION_WORDS = "terrified|scared|afraid|frightened|petrified|panick\\w*|angry|furious|annoyed|irritated|frustrated|fed up|sick of|sick and tired|worried|anxious|nervous|uneasy|on edge|excited|thrilled|heartbroken|devastated|exhausted|traumati[sz]ed|suspicious|distrust\\w*|resent\\w*|hate|hated|love|loved|jealous|lonely";
const EMOTION_CLAIM = new RegExp(`\\b(?:i(?:'m| am| feel| felt| was|'ve been| have been| get| got)|it makes me|makes me|getting|i really|i just)\\b[^.?!]{0,30}\\b(?:${EMOTION_WORDS})\\b|\\b(?:annoy\\w*|irritat\\w*|frustrat\\w*|upset\\w*|scar\\w*|frighten\\w*|worr\\w*|anger\\w*)\\s+(?:me|us)\\b|\\bgetting on my nerves\\b`, "i");
const AFFECT_SYNONYMS = { tense: /\b(?:tense|stress\w*|on edge|uneasy|nervous|anxious|worried)\b/i, pressed: /\b(?:hurr\w*|rush\w*|pressed|running out of time|urgent)\b/i, tired: /\b(?:tired|exhausted|fatigue\w*|worn)\b/i, guarded: /\b(?:guarded|distrust\w*|suspicious|wary)\b/i };
function validateAffectClaims(packet, speech) {
  const capsule = packet?.context_capsule;
  if (!capsule) return { ok: true };
  const match = String(speech).match(EMOTION_CLAIM);
  if (!match) return { ok: true };
  const said = String(packet.player_message?.text ?? "");
  if (new RegExp(`\\b(?:${EMOTION_WORDS})\\b`, "i").test(said)) return { ok: true }; // answering the player's own wording
  const established = (capsule.human_context?.affect ?? []).join(" ") + " " + (capsule.human_context?.relationship ?? "");
  const supported = Object.entries(AFFECT_SYNONYMS).some(([key, re]) => re.test(match[0]) && (key === "tense" ? /tense|stress/i.test(established) : key === "pressed" ? /pressed/i.test(established) : key === "tired" ? /tired/i.test(established) : /guarded/i.test(established)));
  return supported ? { ok: true } : { ok: false, code: "LOCAL_PRESENTATION_FORBIDDEN_CLAIM", reason: `invents a character state not established by canonical context: "${match[0].trim()}"` };
}

function validateLocalDialogue(packet, candidate, runValue = null) {
  // Code knows the speaker and the candidate version; a model-supplied
  // observer_id/version is never authority. Normalize before schema checks.
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof candidate.speech === "string" && packet?.speaker?.observer_id) {
    candidate = { ...candidate, version: CANDIDATE_VERSION, observer_id: packet.speaker.observer_id };
  }
  const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? Object.keys(candidate) : [];
  const requiredKeys = ["version", "observer_id", "speech"];
  const allowedKeys = new Set(["version", "observer_id", "speech", "speech_act", "semantic_claims", "claims", "surface_intent"]);
  if (!requiredKeys.every((k) => k in candidate) || !keys.every((k) => allowedKeys.has(k))) {
    return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  }
  if (candidate.version !== CANDIDATE_VERSION || candidate.observer_id !== packet.speaker.observer_id || typeof candidate.speech !== "string") {
    return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  }
  const speech = candidate.speech.trim();
  if (!speech || speech.length > 600) return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (FORBIDDEN_METADATA.test(speech) || FORBIDDEN_INTERNAL_ID.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_INTERNAL_METADATA" };
  if (INVENTED_PLAYER.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_PLAYER_AGENCY_INVENTED" };
  // Semantic enforcement against the authorized contribution (ED-2). The
  // contribution is the only semantic authority; nothing here re-plans.
  const contribution = packet?.authorized_contribution ?? null;
  const universal = contribution ? { ok: true } : validateUniversalWording(speech);
  if (!universal.ok) return universal;
  const semantic = validateContribution(contribution, speech, { player_text: packet?.player_message?.text ?? null });
  if (!semantic.ok) return semantic;
  const named = validateNamedPeople(packet, speech);
  if (!named.ok) return named;
  const affect = validateAffectClaims(packet, speech);
  if (!affect.ok) return affect;

  const run = runValue ?? packet?._run ?? null;
  if (run) {
    // Plan-carrying packets: validateContribution above is the factual-semantic
    // authority. The legacy claim system (UNSUPPORTED_FACTUAL_SPEECH and
    // semantic_claim reconstruction) serves only callers with no plan.
    const claims = candidate.semantic_claims ?? candidate.claims;
    if (!contribution) {
      if (UNSUPPORTED_FACTUAL_SPEECH.test(speech) && (!Array.isArray(claims) || claims.length === 0)) {
        return { ok: false, code: "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED" };
      }
      if (Array.isArray(claims) && claims.length > 0) {
        const semanticValidation = validateSemanticClaims(claims, candidate.observer_id, run);
        if (!semanticValidation.ok) return semanticValidation;
        if (UNSUPPORTED_FACTUAL_SPEECH.test(speech) && !claims.some((claim) => claimCoversSpeech(claim, speech))) {
          return { ok: false, code: "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED" };
        }
      }
    }
    const claimValidation = validateDialogueClaims(packet, candidate, run);
    if (!claimValidation.ok) return claimValidation;
  }

  return {
    ok: true,
    candidate: deepFreeze({
      version: CANDIDATE_VERSION,
      observer_id: candidate.observer_id,
      speech,
      speech_act: candidate.speech_act ?? null,
      semantic_claims: contribution ? [] : (candidate.semantic_claims ?? candidate.claims ?? []),
      surface_intent: candidate.surface_intent ?? null
    })
  };
}

module.exports = {
  PACKET_VERSION,
  CANDIDATE_VERSION,
  REPORT_PACKET_VERSION,
  getRecentDialogue,
  buildLocalDialoguePacket,
  buildObservationReportPacket,
  validateLocalDialogue,
  validateAffectClaims,
  validateDialogueClaims,
  validateSemanticClaims
};
