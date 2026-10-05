"use strict";

const crypto = require("node:crypto");
const definition = require("../data/worldpacks/clear-q4/cq4-day1-opener.json");
const presentationBus = require("./presentation-bus");

const VERSION = definition.version;
const SCENARIO = definition.scenario;
const RUNTIME_SCENARIO = definition.runtime_scenario;
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Who HEARD a briefing line: the team members in the briefing room when it was spoken (a canonical
// delivery fact the knowledge grants read; a member elsewhere never hears it).
function briefingListeners(run, briefing) {
  const room = briefing?.room_id ?? "async-briefing-room";
  const locations = run?.spatial?.personnel_locations ?? {};
  return (run?.expedition?.team?.members ?? []).filter((member) => {
    const id = member.personnel_id ?? member.id;
    const at = locations[id] ?? null;
    return member.status !== "dead" && (at == null || at === room);
  }).map((member) => member.personnel_id ?? member.id);
}
// Which authored beat a delivered line is (the knowledge grants read beats by key, never by parsing prose).
const BRIEFING_BEAT_KEYS = Object.freeze(["intro", "mission_statement", "schedule", "roster_call"]);
// Canon status of the playable Maxwell briefing (greeting, intro, mission statement, schedule, roster call,
// dismissal). Ratified by the project owner on 2026-09-25 as current Day-1 authored canon under the same
// locked design law as the mission record; see docs/dialogue/DAY1_KNOWLEDGE_MATRIX.md#canon-ratification.
// The undelivered briefing_authority.threshold_sendoff is NOT covered (it conflicts with the crossing order).
const BRIEFING_AUTHORITY_STATUS = "ratified-day1-authored-canon";
const BRIEFING_AUTHORITY_PROVENANCE = "cq4-day1-locked-design-law";
const LEGACY_BRIEFING_STATUS = "legacy_unreconciled_briefing_material";

const BEATS = Object.freeze({
  FACILITY_BROADCAST: "FACILITY_BROADCAST",
  PERSONNEL_BRIEFING: "PERSONNEL_BRIEFING",
  LOCAL_INTRODUCTIONS: "LOCAL_INTRODUCTIONS"
});

const ACTION_DURATIONS_SECONDS = Object.freeze({
  WALK: 30, // Distance / 1.4 m/s (default 30s traversal)
  RUN: 15,
  PHOTOGRAPH: 60, // 1 minute
  READY_EQUIPMENT: 30,
  EXAMINE_QUICK: 60,
  EXAMINE_STANDARD: 180,
  DOCUMENT_DETAILED: 300,
  RADIO_CHECK: 15,
  CONVERSATION_BRIEF: 10,
  CONVERSATION_NORMAL: 30,
  CONVERSATION_EXTENDED: 120,
  WAIT: 60,
  REST: 600
});

function getActionDuration(verb, details = {}) {
  const upper = String(verb ?? "").toUpperCase();
  if (upper === "PHOTOGRAPH") return ACTION_DURATIONS_SECONDS.PHOTOGRAPH;
  if (upper === "MOVE") {
    if (details?.distance != null && Number(details.distance) > 0) {
      return Math.max(5, Math.ceil((Number(details.distance) / 1.4) / 5) * 5);
    }
    return ACTION_DURATIONS_SECONDS.WALK;
  }
  if (upper === "RUN") {
    if (details?.distance != null && Number(details.distance) > 0) {
      return Math.max(5, Math.ceil((Number(details.distance) / 3.0) / 5) * 5);
    }
    return ACTION_DURATIONS_SECONDS.RUN;
  }
  if (upper === "USE" && (details?.item_id === "recording-device" || details?.action === "PHOTOGRAPH" || /photo|camera/i.test(details?.target ?? ""))) {
    return ACTION_DURATIONS_SECONDS.PHOTOGRAPH;
  }
  if (upper === "INSPECT" || upper === "LOOK") {
    if (details?.depth === "detailed") return ACTION_DURATIONS_SECONDS.DOCUMENT_DETAILED;
    if (details?.depth === "standard") return ACTION_DURATIONS_SECONDS.EXAMINE_STANDARD;
    return ACTION_DURATIONS_SECONDS.EXAMINE_QUICK;
  }
  if (upper === "HANDOFF" || upper === "TRANSFER" || upper === "READY") {
    return ACTION_DURATIONS_SECONDS.READY_EQUIPMENT;
  }
  if (upper === "RADIO_CHECK" || upper === "CHECK_IN") {
    return ACTION_DURATIONS_SECONDS.RADIO_CHECK;
  }
  if (upper === "COMMUNICATE" || upper === "LOCAL") {
    if (details?.length === "brief") return ACTION_DURATIONS_SECONDS.CONVERSATION_BRIEF;
    if (details?.length === "extended") return ACTION_DURATIONS_SECONDS.CONVERSATION_EXTENDED;
    return ACTION_DURATIONS_SECONDS.CONVERSATION_NORMAL;
  }
  if (upper === "WAIT") {
    return Number.isInteger(details?.seconds) && details.seconds > 0 ? details.seconds : ACTION_DURATIONS_SECONDS.WAIT;
  }
  if (upper === "REST") {
    return Number.isInteger(details?.seconds) && details.seconds > 0 ? details.seconds : ACTION_DURATIONS_SECONDS.REST;
  }
  return 30;
}

function advanceSimulationTime(run, seconds = 30) {
  if (!isOpener(run?.scenario)) return null;
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  const opener = run.expedition.day1_opener;
  opener.elapsed_seconds = (opener.elapsed_seconds ?? 0) + seconds;

  const totalSecs = opener.elapsed_seconds;
  const startHour = 10;
  const startMinute = 0;
  const addedMinutes = Math.floor(totalSecs / 60);
  const remainingSecs = totalSecs % 60;

  const currentTotalMinutes = startHour * 60 + startMinute + addedMinutes;
  const hour24 = Math.floor(currentTotalMinutes / 60);
  const minute = currentTotalMinutes % 60;

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const ampm = hour24 < 12 ? "AM" : "PM";
  const minuteStr = String(minute).padStart(2, "0");
  const secondStr = String(remainingSecs).padStart(2, "0");

  const formattedTime = `${hour12}:${minuteStr} ${ampm}`;
  opener.simulation_time = formattedTime;
  opener.simulation_time_precise = `${hour12}:${minuteStr}:${secondStr} ${ampm}`;

  // Operational cutoff is 1:00 PM (13:00 / 10,800 seconds elapsed from 10:00 AM)
  const cutoffLimit = opener.operational_cutoff_seconds ?? 10800;
  if (totalSecs > cutoffLimit) {
    opener.cutoff_exceeded = true;
  }

  return {
    elapsed_seconds: totalSecs,
    simulation_time: formattedTime,
    cutoff_exceeded: Boolean(opener.cutoff_exceeded)
  };
}

function isCutoffExceeded(run) {
  if (!isOpener(run?.scenario)) return false;
  const opener = run?.expedition?.day1_opener;
  if (opener?.cutoff_exceeded) return true;
  const totalSecs = opener?.elapsed_seconds ?? 0;
  if (totalSecs > (opener?.operational_cutoff_seconds ?? 10800)) {
    if (opener) opener.cutoff_exceeded = true;
    return true;
  }
  return false;
}

function triggerCatastrophicEnding(world, entry) {
  const run = entry?.run ?? entry;
  const expedition = run.expedition ??= {};
  const opener = expedition.day1_opener ??= {};

  opener.catastrophic_ending = {
    active: true,
    stage: "terminal",
    asset_id: "ending.catastrophic.newspaper",
    headline: "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA",
    date: "JULY 17, 1991",
    location: "Santa Clarita, California",
    casualties: 4,
    ambiguity_doctrine: "unexplained-correspondence",
    sequence: [
      "nonfunctional_threshold",
      "coworker_panic",
      "aeot_power_failure",
      "async_logo_display",
      "newspaper_record",
      "terminal_title_transition"
    ],
    triggered_at_interval: expedition.clock?.interval ?? 18,
    triggered_at_simulation_time: opener.simulation_time ?? "1:00 PM"
  };

  // Coworkers enter panicked state
  for (const member of expedition.team?.members ?? []) {
    if (member.identity !== run.session?.startup?.player?.observer_id) {
      member.behavioral_state = "panicked";
      member.stress = 10;
      member.current_intent = "survive catastrophic Threshold failure";
    }
  }

  presentationBus.emit(run, {
    type: "threshold_nonfunctional",
    speaker: "FACILITY",
    text: "The Threshold is dead. The magnetic aperture has completely collapsed."
  });
  presentationBus.emit(run, {
    type: "character_panic",
    speaker: "TEAM",
    text: "Coworkers recognize that the return route is severed. Uncontrolled panic ensues."
  });
  presentationBus.emit(run, {
    type: "aeot_power_failure",
    source: "aeot",
    text: "AEOT terminal loses connection to Standard relay. Screen zaps to black."
  });
  presentationBus.emit(run, {
    type: "async_logo_display",
    source: "institutional",
    asset: "async.logo"
  });
  presentationBus.emit(run, {
    type: "newspaper_record",
    asset_id: "ending.catastrophic.newspaper",
    headline: "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA",
    date: "JULY 17, 1991"
  });

  run.lifecycle = "completed";
  if (entry.phase) entry.phase.phase_id = "DEBRIEF";

  if (world) {
    world.q4_operations ??= {};
    world.q4_operations.terminal_outcome = {
      run_id: run.run_id,
      outcome: "catastrophic-failure",
      reason: "Post-1:00 PM operational cutoff exceeded Complex-side. Trapped personnel.",
      asset_id: "ending.catastrophic.newspaper",
      at: new Date().toISOString()
    };
  }

  return {
    ok: false,
    error: {
      code: "THRESHOLD_NONFUNCTIONAL",
      message: "The Threshold is completely dark and unresponsive. The aperture has collapsed. Operational cutoff exceeded."
    },
    result: {
      public_reason: "The Threshold is dead. Standard line is unresponsive. Egress is impossible.",
      catastrophic_ending: clone(opener.catastrophic_ending)
    },
    public_reason: "The Threshold is dead. Standard line is unresponsive. Egress is impossible.",
    run
  };
}

const ONE_SHOT_EVENTS = Object.freeze([
  "briefing_date_card",
  "maxwell_opening_briefing",
  "intern_greets_player",
  "surveyor_greets_player",
  "doctor_greets_player",
  "radio_check_initial_cue",
  "radio_check_tone_feedback",
  "threshold_approach_rumble",
  "threshold_door_parting",
  "crossing_cutscene",
  "complex_acoustic_transition",
  "tape_discovery_cue",
  "outpost_a_revealed",
  "duffle_drop_acknowledge",
  "intern_completion_quip",
  "return_route_familiarity_cue",
  "kv31_return_chime",
  "cold_boot_state_preserved"
]);

function isOneShotConsumed(run, eventId) {
  if (!isOpener(run?.scenario)) return false;
  return Boolean(run?.expedition?.day1_opener?.one_shot_events?.[eventId]?.consumed);
}

function markOneShotConsumed(run, eventId, metadata = {}) {
  if (!isOpener(run?.scenario)) return false;
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  run.expedition.day1_opener.one_shot_events ??= {};
  run.expedition.day1_opener.one_shot_events[eventId] = {
    consumed: true,
    at_interval: run.expedition.clock?.interval ?? 0,
    consumed_at: new Date().toISOString(),
    ...metadata
  };
  return true;
}

function ensureWorldOutpostGeography(world) {
  if (!world || typeof world !== "object") return null;
  if (world.q4_day1_geography) {
    return world.q4_day1_geography;
  }
  const seed = String(world.seed ?? "day1-opener");
  const hash = digest([seed, "outpost-a-geometry"]);
  const seedNum = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  const dx = 120 + (seedNum % 60);
  const dy = ((seedNum % 5) - 2) * 40;
  const geography = {
    version: VERSION,
    location_id: "outpost-a",
    name: "Outpost A (Bermuda Branch)",
    coordinates: { x: 580 + dx, y: 130 + dy, level: 0 },
    seed,
    created_at: new Date().toISOString()
  };
  world.q4_day1_geography = geography;
  return geography;
}

function validate() {
  if (VERSION !== "yellow-beast-cq4-opener@v1" || definition.id !== "clear-q4-day1-opener") {
    throw new Error("unsupported CQ4 Day 1 Opener definition");
  }
  if (definition.staffing.total !== 4 || definition.staffing.coworker_roles.length !== 3) {
    throw new Error("CQ4 Day 1 Opener staffing must be exactly player plus three coworkers");
  }
  return true;
}

function isOpener(value) {
  return value === SCENARIO || value === RUNTIME_SCENARIO || value === "day1-opener" || value === "cq4-day1-opener";
}

function staffingRules(base = {}) {
  validate();
  return { ...base, ...clone(definition.staffing), starter_roster: true };
}

function mission({ run_id = null, seed = "day1-opener", staffing = null } = {}) {
  validate();
  const authored = definition.mission;
  const hash = digest([seed, run_id]).slice(0, 8).toUpperCase();
  return {
    version: "yellow-beast-q4-missions@v2",
    id: `CQ4-DAY1-${hash}`,
    display_id: "CQ4-DAY1-001",
    specimen_id: definition.id,
    assignment_authority: "ASYNC / Standard",
    family: authored.family,
    family_label: authored.family_label,
    authority: {
      classification: "authoritative-canonical-opener",
      source_claim_ids: [],
      provenance: BRIEFING_AUTHORITY_PROVENANCE,
      // The mission record and the briefing agree: the delivered briefing is ratified Day-1 canon.
      briefing_status: BRIEFING_AUTHORITY_STATUS
    },
    rationale: authored.rationale,
    site: clone(authored.site),
    objective: {
      primary: authored.primary,
      procedures: clone(authored.procedures),
      completion_criteria: [
        "Enter the Complex through KV31 Threshold Chamber.",
        "Reach Outpost A (Bermuda branch).",
        "Deliver the startup prerequisite materials in Outpost A.",
        "Return through KV31 before 12:00."
      ]
    },
    assigned_personnel: staffing?.team?.map((person) => person.identity) ?? [],
    required_equipment: ["field-camera", "field-light", "startup-materials-duffle", "layout-record"],
    operational_window: clone(definition.operational_window),
    briefing_authority: clone(definition.briefing_authority),
    reporting: {
      check_ins: [
        "Complete formal radio check upstairs in KV31 Threshold Chamber prior to departure.",
        "Transmit formal 2-second hold check-in once every Standard hour.",
        "Verify return with Control Room surveillance before re-crossing."
      ],
      evidence: [
        "Retain photographic documentation of the guidance path and Outpost A.",
        "Record manifestation layout and condition observations."
      ],
      abort_conditions: [
        "Return immediately if personnel accountability or physical safety prevents mission completion."
      ],
      summary: "Report delivery status of startup materials, route condition, and personnel accountability."
    },
    expected_duration: "10:00 AM to 12:00 noon (2 Standard hours)",
    deployment_time: definition.operational_window.deployment_time,
    expected_return_time: definition.operational_window.expected_return_time,
    risks: [
      { text: "Uncertain route geometry and potential disorientation beyond the guidance line.", knowledge_status: "known operational factor" }
    ],
    safety_constraints: clone(definition.safety_constraints),
    status: "assigned",
    run_id,
    generated_from: { seed, specimen_id: definition.id }
  };
}

function instantiate(run) {
  validate();
  if (!isOpener(run?.scenario) || !run.spatial) return run;

  // Initialize Day 1 Opener state if not present
  run.expedition ??= {};
  run.expedition.day1_opener ??= {
    version: VERSION,
    delivery_completed: false,
    delivery_location: "outpost-a",
    delivery_item: "startup-materials-duffle",
    return_surveillance_verified: false,
    check_in_held_seconds: 0,
    last_check_in_time: null,
    one_shot_events: {},
    elapsed_seconds: 0,
    clock_start: "10:00 AM",
    simulation_time: "10:00 AM",
    operational_cutoff_seconds: 10800,
    cutoff_exceeded: false,
    catastrophic_ending: null
  };
  run.expedition.day1_opener.one_shot_events ??= {};
  run.expedition.day1_opener.elapsed_seconds ??= (run.expedition.clock?.interval ?? 0) * 600;
  run.expedition.day1_opener.clock_start ??= "10:00 AM";
  run.expedition.day1_opener.simulation_time ??= "10:00 AM";
  run.expedition.day1_opener.operational_cutoff_seconds ??= 10800;
  run.expedition.day1_opener.cutoff_exceeded ??= false;
  run.expedition.day1_opener.catastrophic_ending ??= null;

  const members = run.expedition.team?.members ?? [];
  const playerName = members[0]?.first_name || members[0]?.display_name || "Assignee";
  const coworker1Name = members[1]?.first_name || members[1]?.display_name || "Teammate";
  const coworker2Name = members[2]?.first_name || members[2]?.display_name || "Courier";
  const coworker3Name = members[3]?.first_name || members[3]?.display_name || "Doctor";
  const dialogue = definition.briefing_authority.dialogue;
  const rosterCall = dialogue.roster_call
    .replace("{player_name}", playerName)
    .replace("{coworker1_name}", coworker1Name)
    .replace("{coworker2_name}", coworker2Name)
    .replace("{coworker3_name}", coworker3Name);
  run.expedition.day1_opener.beat ??= BEATS.PERSONNEL_BRIEFING;
  run.expedition.day1_opener.facility_broadcast ??= {
    channel: "FACILITY BROADCAST",
    mandatory: false,
    visible: false,
    status: "completed",
    completed: true,
    chirps_emitted: true,
    title: definition.briefing_authority.title_template,
    media_asset: {
      placeholder_id: "BRIEFING_INFORMATIONAL_VIDEO"
    },
    chirps: [],
    visual: { mode: "facility", substrate: "primary-visual-panel" }
  };
  run.expedition.day1_opener.personnel_briefing ??= {
    speaker: "DR. KIRK MAXWELL",
    speaker_title: "Chief Expedition Briefing Authority · Standard Side",
    room_id: "async-briefing-room",
    room_name: "ASYNC FACILITY // LOWER LEVEL",
    dialogue: {
      greeting: dialogue.greeting,
      intro: dialogue.intro,
      mission_statement: dialogue.mission_statement,
      roster_call: rosterCall,
      dismissal: dialogue.dismissal
    },
    text: [dialogue.greeting, dialogue.intro, dialogue.mission_statement, rosterCall, dialogue.dismissal].join(" "),
    authority_status: BRIEFING_AUTHORITY_STATUS,
    authority_provenance: BRIEFING_AUTHORITY_PROVENANCE,
    status: "pending",
    exchange_history: [],
    facts_communicated: {
      briefing_authority: "Dr. Kirk Maxwell",
      working_relationship: "Kirk",
      deployment_time: definition.operational_window?.deployment_time ?? "10:00 AM",
      expected_return: definition.operational_window?.expected_return_time ?? "12:00 noon",
      cutoff_time: definition.operational_window?.cutoff_time ?? "1:00 PM",
      destination: "Outpost A (Bermuda branch)",
      route_guidance: "neon-green guidance tape with arrows (forward to Outpost A, reverse to KV31)",
      team_size: 4
    }
  };
  // Saves made before ratification carry the legacy label; the authored scene itself is unchanged.
  const savedBriefing = run.expedition.day1_opener.personnel_briefing;
  if (savedBriefing && (savedBriefing.authority_status === LEGACY_BRIEFING_STATUS || !savedBriefing.authority_status)) {
    savedBriefing.authority_status = BRIEFING_AUTHORITY_STATUS;
    savedBriefing.authority_provenance = BRIEFING_AUTHORITY_PROVENANCE;
  }
  run.expedition.day1_opener.esd_handoff ??= {
    status: "introductions-open",
    destination: "Equipment Services Division",
    player_dialogue_input: "local-open",
    coworker_activity: "active"
  };
  run.expedition.day1_opener.introduction_pressure ??= members.slice(1).map((member) => ({
    personnel_id: member.personnel_id ?? member.id,
    prompt: `${member.first_name ?? member.display_name} is waiting with the rest of the assigned team.`,
    concern: run._world?.characters?.[member.personnel_id ?? member.id]?.identity_substrate?.pre_expedition_concern ?? null
  }));

  const seed = String(run.seed ?? "day1-opener");
  const hash = digest([seed, "outpost-a-geometry"]);
  const seedNum = Number.parseInt(hash.slice(0, 8), 16) >>> 0;

  // Ensure Outpost A exists in generated_locations
  const existingOutpost = (run.spatial.generated_locations ?? []).find((loc) => loc.id === "outpost-a");
  if (!existingOutpost) {
    run.spatial.generated_locations ??= [];
    run.spatial.generated_connections ??= [];
    run.spatial.route_markers ??= [];

    // Calculate seed-dependent coordinate offset or use persistent world geography
    const worldGeo = ensureWorldOutpostGeography(run._world);
    const dx = 120 + (seedNum % 60);
    const dy = ((seedNum % 5) - 2) * 40;
    const outpostCoordinates = worldGeo?.coordinates ? clone(worldGeo.coordinates) : { x: 580 + dx, y: 130 + dy, level: 0 };

    const outpostLocation = {
      id: "outpost-a",
      name: "Outpost A (Bermuda Branch)",
      type: "outpost",
      short_description: "A forward ASync operational staging point under fluorescent lighting. Two folding tables sit against the drywall beside emptied boxes, wooden slats, screwdrivers, and a field radio station.",
      coordinates: outpostCoordinates,
      entry_state: "unmapped",
      environment: {
        lighting: "steady fluorescent tubes",
        surface: "concrete floor with adhesive remnants",
        sound: "a quiet fluorescent fixture hum"
      },
      landmarks: [
        {
          id: "outpost-a-placard",
          name: "stenciled equipment placard",
          aliases: ["placard", "stencil", "sign", "label", "stenciled equipment placard", "outpost-a-placard", "ASYNC OUTPOST A // BERMUDA BRANCH", "A-SYNC OUTPOST A // BERMUDA BRANCH"],
          observation: "A stenciled equipment placard reads: ASYNC OUTPOST A // BERMUDA BRANCH.",
          inspection: "The stenciled equipment placard is riveted into the drywall: ASYNC OUTPOST A // BERMUDA BRANCH."
        },
        {
          id: "folding-tables",
          name: "folding tables",
          aliases: ["folding-tables", "folding tables", "tables", "table", "folding table"],
          observation: "Two metal folding tables sit against the drywall with emptied boxes, wooden slats, and screwdrivers.",
          inspection: "Two metal folding tables provide an operational staging surface beside the drywall."
        },
        {
          id: "wooden-slats",
          name: "wooden slats",
          aliases: ["wooden-slats", "wooden slats", "slats", "wood slats"],
          observation: "Bundled wooden slats lean against the drywall beside the tables.",
          inspection: "Unpainted pine slats bundled with twine, left from initial outpost construction."
        },
        {
          id: "radio-interface",
          name: "radio interface",
          aliases: ["radio-interface", "radio interface", "stationary radio", "outpost radio", "radio station"],
          observation: "A stationary field radio interface unit is mounted on the folding table.",
          inspection: "A heavy field radio interface bolted to the table, wired to monitor the KV31 Threshold frequency."
        },
        {
          id: "emptied-boxes",
          name: "emptied boxes",
          aliases: ["emptied-boxes", "emptied boxes", "empty boxes", "boxes", "cartons"],
          observation: "Several emptied cardboard shipping boxes rest beneath the folding tables.",
          inspection: "Corrugated boxes marked with ASync logistics codes, their contents already unpacked."
        },
        {
          id: "screwdrivers",
          name: "screwdrivers",
          aliases: ["screwdrivers", "screwdriver", "hand tools", "tools"],
          observation: "A set of maintenance screwdrivers lies near the edge of the folding table.",
          inspection: "Two flathead and two Phillips screwdrivers with scuffed yellow plastic handles."
        },
        {
          id: "guidance-tape-outpost",
          name: "neon-green guidance tape termination",
          aliases: ["guidance tape", "green tape", "directional tape", "tape termination"],
          observation: "The thick neon-green guidance tape terminates here on the concrete floor beside the tables.",
          inspection: "The bright green adhesive tape ends beside the folding tables, with reverse arrows pointing back toward KV31."
        },
        {
          id: "clipped-swivel-chair",
          name: "swivel-seat chair partially clipped into the wall",
          aliases: ["swivel chair", "clipped chair", "chair", "swivel-seat chair", "office chair", "anomalous chair"],
          observation: "An office swivel-seat chair is partially clipped into the drywall, its backrest embedded directly into the wall surface.",
          inspection: "The padded brown vinyl swivel chair physically intersects the drywall without seam or fracture. The vinyl and steel five-star base are intact where exposed; the backrest penetrates the wall as though the architecture occupied the same physical coordinates. It is non-hostile, stable, and completely stationary.",
          anomalous: true,
          anomaly_family: "SPATIAL_INCONSISTENCY"
        },
        {
          id: "blue-boundary-tape",
          name: "blue anomaly boundary tape",
          aliases: ["blue tape", "boundary tape", "perimeter tape", "blue marker tape", "investigation tape"],
          observation: "Strips of dark blue adhesive tape are applied to the floor and wall forming a perimeter around the clipped chair.",
          inspection: "Heavy blue vinyl tape placed by prior ASync personnel demarcates the perimeter of the anomalous chair intersection, indicating an established institutional survey perimeter.",
          state: "canonical-physical-object"
        }
      ],
      hazards: [],
      tags: ["field", "outpost", "mission-destination"]
    };

    const intermediateId = `corridor-bermuda-${hash.slice(0, 6)}`;
    const intermediateLocation = {
      id: intermediateId,
      name: "Bermuda Access Corridor",
      type: "corridor",
      short_description: "A wide corridor with scuffed linoleum floor under fluorescent illumination.",
      coordinates: { x: 500 + Math.floor(dx / 2), y: 130 + Math.floor(dy / 2), level: 0 },
      entry_state: "unmapped",
      environment: {
        lighting: "fluorescent tubes",
        surface: "scuffed linoleum floor",
        sound: "low electric drone"
      },
      landmarks: [
        {
          id: "guidance-tape-intermediate",
          name: "neon-green guidance tape",
          aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
          observation: "Thick neon-green adhesive tape with directional arrows runs along the linoleum floor.",
          inspection: "The tape has printed black directional arrows pointing forward toward Outpost A and reverse toward KV31."
        }
      ],
      hazards: [],
      tags: ["field", "corridor", "guidance-route"]
    };

    // Canonical Day-One Anomaly Floor (Phase 26):
    // Every valid Day-One Bermuda generation must contain at least one perceptible anomalous element.
    const ANOMALY_FAMILIES = ["ACOUSTIC_ANOMALY", "ENVIRONMENTAL_DISCONTINUITY", "SPATIAL_INCONSISTENCY", "OBJECT_DISPLACEMENT"];
    const anomalyFamily = ANOMALY_FAMILIES[seedNum % ANOMALY_FAMILIES.length];
    const anomalyTargetId = (seedNum % 2 === 0) ? intermediateId : "outpost-a";

    if (anomalyFamily === "ACOUSTIC_ANOMALY") {
      intermediateLocation.environment.sound = "an unlocalized low-frequency acoustic vibration that pulses counter to the fluorescent drone";
      intermediateLocation.acoustic_anomaly = true;
      intermediateLocation.anomalous = true;
    } else if (anomalyFamily === "ENVIRONMENTAL_DISCONTINUITY") {
      intermediateLocation.environment.lighting = "fluorescent tubes with an unexplained localized cold drift along the walls";
      intermediateLocation.anomalous = true;
    } else if (anomalyFamily === "SPATIAL_INCONSISTENCY") {
      intermediateLocation.short_description = "A wide corridor with scuffed linoleum floor where sightlines appear subtly distorted under fluorescent illumination.";
      intermediateLocation.anomalous = true;
    } else if (anomalyFamily === "OBJECT_DISPLACEMENT") {
      intermediateLocation.landmarks.push({
        id: "displaced-conduit-cover",
        name: "displaced conduit cover",
        aliases: ["conduit cover", "cover", "metal plate"],
        observation: "A rectangular metal conduit cover lies displaced in the center of the corridor without visible tool marks.",
        inspection: "The cover is undamaged and shows no fastening hardware or pry marks."
      });
      intermediateLocation.anomalous = true;
    }

    if (run._world) {
      try {
        const phenomena = require("./q4-phenomenon-ecology");
        phenomena.instantiate(run._world, {
          family: anomalyFamily,
          location_id: anomalyTargetId,
          spatial: run.spatial,
          generation: { mode: "day1-opener-anomaly-floor", config_version: "yellow-beast-q4-phenomenon-config@v1" }
        });
      } catch {}
    }

    run.spatial.generated_locations.push(intermediateLocation, outpostLocation);

    // Connections: utility-room -> intermediate -> outpost-a
    run.spatial.generated_connections.push(
      {
        id: `conn-utility-${intermediateId}`,
        from: "utility-room",
        to: intermediateId,
        direction: "east",
        reverse_direction: "west",
        relationship: "access corridor",
        transition: "The team follows the green tape along the floor through the eastern accessway.",
        reverse_transition: "The team retraces the green tape westward toward the utility room.",
        lock_state: "open",
        hazard_state: "clear",
        visibility: "visible",
        discovery: "on-traversal",
        bidirectional: true,
        aliases: ["east", "corridor", "green tape", "arrows", "accessway"]
      },
      {
        id: `conn-${intermediateId}-outpost`,
        from: intermediateId,
        to: "outpost-a",
        direction: "forward",
        reverse_direction: "back",
        relationship: "outpost threshold",
        transition: "The team follows the guidance tape through double framed doors into Outpost A.",
        reverse_transition: "The team steps out of Outpost A back into the access corridor.",
        lock_state: "open",
        hazard_state: "clear",
        visibility: "visible",
        discovery: "on-traversal",
        bidirectional: true,
        aliases: ["forward", "outpost", "double doors", "green tape"]
      }
    );

    // Physical neon-green guidance tape markers
    run.spatial.route_markers.push(
      {
        id: "tape-marker-utility",
        location: "utility-room",
        label: "Thick neon-green tape with directional arrows",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
        direction: "toward Outpost A",
        description: "Thick neon-green adhesive tape with printed directional arrows runs along the scuffed floor heading toward Outpost A.",
        state: "canonical-physical-object"
      },
      {
        id: "tape-marker-intermediate",
        location: intermediateId,
        label: "Thick neon-green tape with directional arrows",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
        direction: "pointing to Outpost A / reverse to KV31",
        description: "Thick neon-green adhesive tape with directional arrows continues along the corridor floor, pointing forward to Outpost A and reverse to KV31.",
        state: "canonical-physical-object"
      },
      {
        id: "tape-marker-outpost",
        location: "outpost-a",
        label: "Neon-green tape termination beside folding tables",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "tape termination"],
        direction: "reverse to KV31",
        description: "The neon-green tape terminates cleanly on the floor beside the folding tables, with arrows pointing back along the corridor reverse to KV31.",
        state: "canonical-physical-object"
      }
    );
  }

  return run;
}

function verifyDelivery(run) {
  if (!isOpener(run?.scenario)) return false;
  const expedition = run.expedition;

  const duffle = expedition?.equipment?.["startup-materials-duffle"]
    ?? expedition?.logistics?.items?.["startup-materials-duffle"]
    ?? Object.values(expedition?.equipment ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle")
    ?? Object.values(expedition?.logistics?.items ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle");

  if (!duffle) return false;

  // The duffle must be physically deposited at outpost-a (placed or dropped, and not currently held)
  const atOutpost = duffle.location === "outpost-a" || duffle.current_location === "outpost-a";
  const unheld = (duffle.holder == null && duffle.current_holder == null) || duffle.state === "dropped" || duffle.condition === "dropped";

  if (atOutpost && unheld) {
    if (expedition?.day1_opener) expedition.day1_opener.delivery_completed = true;
    return true;
  }
  if (expedition?.day1_opener) expedition.day1_opener.delivery_completed = false;
  return false;
}

function verifyReturn(run) {
  if (!isOpener(run?.scenario)) return false;
  if (isCutoffExceeded(run)) return false;
  const playerLoc = run.spatial?.player_location;
  const isAtKV31 = playerLoc === "utility-room" || playerLoc === "threshold-side-entry";
  const surveillanceVerified = Boolean(run.expedition?.day1_opener?.return_surveillance_verified);
  return isAtKV31 && surveillanceVerified;
}

function writeReport(run, { author = null, text, at = null } = {}) {
  if (!isOpener(run?.scenario) || run?.lifecycle !== "completed") return { ok: false, code: "OPENER_REPORT_UNAVAILABLE" };
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) return { ok: false, code: "OPENER_REPORT_EMPTY" };
  if (body.length > 4000) return { ok: false, code: "OPENER_REPORT_TOO_LONG" };
  const writer = author ?? run.session?.startup?.player?.observer_id;
  if (!writer || writer !== run.session?.startup?.player?.observer_id) return { ok: false, code: "OPENER_REPORT_AUTHOR_INVALID" };
  const existing = run.expedition?.written_report;
  if (existing) return existing.text === body ? { ok: true, idempotent: true, report: clone(existing) } : { ok: false, code: "OPENER_REPORT_ALREADY_SUBMITTED" };
  const report = {
    version: "yellow-beast-opener-written-report@v1",
    id: `opener-report-${digest([run.run_id, run.expedition?.mission?.id, writer]).slice(0, 16)}`,
    mission_id: run.expedition?.mission?.id ?? null,
    run_id: run.run_id,
    author: writer,
    text: body,
    submitted_at: { interval: Number.isInteger(at) ? at : run.expedition?.clock?.interval ?? 0 },
    kind: "player-authored-claim",
    available_evidence_ids: [],
    institutional_assessment: null
  };
  run.expedition.written_report = report;
  return { ok: true, idempotent: false, report: clone(report) };
}

function assessInstitutionalRecord({ report, run, evidence_records = [] } = {}) {
  const deliveryCompleted = Boolean(run?.expedition?.day1_opener?.delivery_completed);
  const returnVerified = Boolean(run?.expedition?.day1_opener?.return_surveillance_verified);
  const interval = run?.expedition?.clock?.interval ?? 0;

  const duffle = run?.expedition?.logistics?.items?.["startup-materials-duffle"]
    ?? run?.expedition?.equipment?.["startup-materials-duffle"]
    ?? Object.values(run?.expedition?.logistics?.items ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle")
    ?? Object.values(run?.expedition?.equipment ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle");

  const playerLoc = run?.spatial?.player_location;
  const isAtKV31 = playerLoc === "utility-room" || playerLoc === "threshold-side-entry";
  const duffleAtKV31 = duffle && (
    duffle.location === playerLoc ||
    duffle.current_location === playerLoc ||
    duffle.location === "utility-room" ||
    duffle.current_location === "utility-room" ||
    (duffle.holder && (run?.spatial?.personnel_locations?.[duffle.holder] === playerLoc || isAtKV31)) ||
    (duffle.current_holder && (run?.spatial?.personnel_locations?.[duffle.current_holder] === playerLoc || isAtKV31))
  );

  const returnedSeconds = run?.expedition?.day1_opener?.returned_elapsed_seconds
    ?? run?.expedition?.day1_opener?.elapsed_seconds ?? 0;
  const isLate = returnedSeconds > 7200;

  let status = "delivery-confirmed";
  let summary = "Startup materials confirmed delivered to Outpost A. Field reconnaissance completed with accounted return.";

  if (isLate) {
    status = "late-return";
    summary = `Expedition returned after the noon expectation (${returnedSeconds} seconds after 10:00 AM). Egress logged.`;
  } else if (!deliveryCompleted) {
    if (duffleAtKV31) {
      status = "delivery-undelivered";
      summary = "Startup materials were not delivered to Outpost A and were brought back to KV31. Mission incomplete.";
    } else {
      status = "delivery-lost-materials";
      summary = "Startup materials were not delivered to Outpost A and were unaccounted or abandoned in the Complex.";
    }
  } else if (!returnVerified) {
    status = "surveillance-unverified-return";
    summary = "Materials delivered to Outpost A, but return procedure lacked Standard visual surveillance confirmation.";
  }

  return {
    version: "yellow-beast-opener-institutional-assessment@v1",
    status,
    confidence: "institutional-intake-verified",
    summary,
    basis: {
      written_report_id: report?.id,
      delivery_completed: deliveryCompleted,
      return_verified: returnVerified,
      interval,
      returned_elapsed_seconds: returnedSeconds,
      evidence_ids: evidence_records.map((r) => r.id),
      duffle_recovered: Boolean(duffleAtKV31),
      is_late: isLate
    },
    claims_cause: false
  };
}

function logisticsDefinition(base) {
  const cloned = clone(base);
  cloned.item_definitions ??= [];
  if (!cloned.item_definitions.some((d) => d.id === "startup-materials-duffle")) {
    cloned.item_definitions.push({
      id: "startup-materials-duffle",
      display_name: "Startup materials duffle",
      category: "equipment",
      model: "heavy canvas startup materials duffle",
      capabilities: ["prerequisite material transport"],
      capacity_contribution: 1,
      maximum_charges: 1,
      consumable: false
    });
  }
  if (!cloned.item_definitions.some((d) => d.id === "layout-record")) {
    cloned.item_definitions.push({
      id: "layout-record",
      display_name: "Manifestation layout record",
      category: "recording",
      model: "field clipboard and layout record sheets",
      capabilities: ["layout documentation"],
      capacity_contribution: 1,
      maximum_charges: 10,
      consumable: false
    });
  }
  if (!cloned.item_definitions.some((d) => d.id === "mass-spectrometer")) {
    cloned.item_definitions.push({
      id: "mass-spectrometer",
      display_name: "Portable mass spectrometer",
      category: "instrument",
      model: "analytical mass spectrometer",
      capabilities: ["compositional analysis"],
      capacity_contribution: 1,
      maximum_charges: 10,
      consumable: false
    });
  }
  cloned.item_instances = [
    { id: "field-light", definition_id: "battery-lamp", assignment: { holder: "player" }, initial_container: "player-harness", initial_location: "equipment-staging", initial_charges: 6 },
    { id: "recording-device", definition_id: "field-camera", assignment: { holder: "player" }, initial_container: "player-harness", initial_location: "equipment-staging", initial_charges: 24 },
    { id: "mass-spectrometer", definition_id: "mass-spectrometer", assignment: { holder: "coworker1", role: "field researcher" }, initial_container: null, initial_location: "equipment-staging", initial_charges: 10 },
    { id: "startup-materials-duffle", definition_id: "startup-materials-duffle", assignment: { role: "field technician" }, initial_container: null, initial_location: "equipment-staging", initial_charges: 1 },
    { id: "layout-record", definition_id: "layout-record", assignment: { role: "field medical doctor" }, initial_container: null, initial_location: "equipment-staging", initial_charges: 10 },
    { id: "field-notebook", definition_id: "field-notebook", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_charges: 30 },
    { id: "spare-film", definition_id: "spare-film", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 1 },
    { id: "route-marker-kit", definition_id: "route-marker-kit", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_charges: 8 },
    { id: "evidence-sleeves", definition_id: "evidence-sleeves", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 4 },
    { id: "spare-battery", definition_id: "spare-battery", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 1 }
  ];
  cloned.loadout = {
    required: ["field-light", "recording-device", "mass-spectrometer", "startup-materials-duffle", "layout-record"],
    optional: ["field-notebook", "spare-film", "route-marker-kit", "evidence-sleeves", "spare-battery"],
    waiver_allowed: false,
    public_recommendations: []
  };
  cloned.assigned_manifest = clone(definition.assigned_manifest);
  cloned.hard_capacity_per_person = 2;
  return cloned;
}

function isBroadcastStandby(run) {
  if (!isOpener(run?.scenario)) return false;
  return run?.expedition?.day1_opener?.facility_broadcast?.status === "standby";
}

function isBroadcastActive(run) {
  if (!isOpener(run?.scenario)) return false;
  const broadcast = run?.expedition?.day1_opener?.facility_broadcast;
  return Boolean(broadcast?.status === "in-progress" && broadcast?.visible && !broadcast?.completed);
}

function isBroadcastCompleted(run) {
  if (!isOpener(run?.scenario)) return true;
  return Boolean(run?.expedition?.day1_opener?.facility_broadcast?.completed);
}

function startBroadcast(run) {
  if (!isOpener(run?.scenario)) return { ok: false, code: "NOT_OPENER" };
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  const opener = run.expedition.day1_opener;
  opener.facility_broadcast ??= {};
  opener.beat = BEATS.PERSONNEL_BRIEFING;
  opener.facility_broadcast.status = "completed";
  opener.facility_broadcast.visible = false;
  opener.facility_broadcast.completed = true;
  return { ok: true, beat: BEATS.PERSONNEL_BRIEFING, already_completed: true };
}

function completeBroadcast(run) {
  if (!isOpener(run?.scenario)) return { ok: false, code: "NOT_OPENER" };
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  const opener = run.expedition.day1_opener;
  opener.beat = BEATS.PERSONNEL_BRIEFING;
  opener.facility_broadcast ??= {};
  opener.facility_broadcast.completed = true;
  opener.facility_broadcast.visible = false;
  opener.facility_broadcast.status = "completed";
  return { ok: true, beat: BEATS.PERSONNEL_BRIEFING };
}

function startPersonnelBriefing(run) {
  if (!isOpener(run?.scenario)) return { ok: false, code: "NOT_OPENER" };
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  const opener = run.expedition.day1_opener;
  opener.personnel_briefing ??= {};
  const briefing = opener.personnel_briefing;
  briefing.speaker ??= "DR. KIRK MAXWELL";
  briefing.speaker_title ??= "Chief Expedition Briefing Authority · Standard Side";
  briefing.room_id ??= "async-briefing-room";
  briefing.room_name ??= "ASYNC FACILITY // LOWER LEVEL";
  briefing.exchange_history ??= [];

  if (briefing.status === "concluded") {
    return { ok: true, status: "concluded", beat: opener.beat, briefing };
  }

  briefing.status = "active";
  const beats = [
    [briefing.dialogue?.greeting, briefing.dialogue?.intro].filter(Boolean).join(" "),
    briefing.dialogue?.mission_statement,
    "Departure is scheduled for 10:00 AM, expected return 12:00 noon, cutoff 1:00 PM firm.",
    briefing.dialogue?.roster_call
  ].filter(Boolean);
  briefing.current_beat_index ??= 0;
  briefing.beats_total = beats.length;

  if (briefing.exchange_history.length === 0) {
    const firstBeat = beats[0] || briefing.text || "Good morning.";
    briefing.current_beat_index = 0;
    briefing.exchange_history.push({
      speaker: briefing.speaker,
      speaker_title: briefing.speaker_title,
      text: firstBeat,
      beat_key: BRIEFING_BEAT_KEYS[0],
      listeners: briefingListeners(run, briefing),
      at_interval: Number(run.expedition.clock?.interval ?? 0),
      at: new Date().toISOString()
    });

    presentationBus.emit(run, {
      type: presentationBus.EVENT_TYPES.DIALOGUE,
      source: presentationBus.SOURCES.DETERMINISTIC,
      channel: "LOCAL",
      speaker: briefing.speaker,
      speaker_id: "kirk-maxwell",
      speaker_title: briefing.speaker_title,
      recipient_type: "group",
      recipient_id: "@briefing",
      recipient_name: "Q4 Assignees",
      text: firstBeat
    });
    markOneShotConsumed(run, "maxwell_opening_briefing");
  }

  return {
    ok: true,
    status: "active",
    beat: opener.beat ?? BEATS.PERSONNEL_BRIEFING,
    briefing
  };
}

function interactPersonnelBriefing(run, input = "") {
  if (!isOpener(run?.scenario)) return { ok: false, code: "NOT_OPENER" };
  const opener = run?.expedition?.day1_opener;
  const briefing = opener?.personnel_briefing;
  if (!briefing || briefing.status !== "active") {
    return { ok: false, code: "BRIEFING_NOT_ACTIVE", message: "Personnel briefing is not currently active." };
  }

  const raw = String(input ?? "").trim();
  briefing.exchange_history ??= [];
  const beats = [
    [briefing.dialogue?.greeting, briefing.dialogue?.intro].filter(Boolean).join(" "),
    briefing.dialogue?.mission_statement,
    "Departure is scheduled for 10:00 AM, expected return 12:00 noon, cutoff 1:00 PM firm.",
    briefing.dialogue?.roster_call
  ].filter(Boolean);
  briefing.current_beat_index ??= 0;
  briefing.beats_total = beats.length;

  const isExplicitConclusion = /^(conclude|dismiss|dismissed|leave|exit|done|finish|finished|let'?s go|staging|equipment staging|no questions|none|nothing|no|clear|all set|silence)\.?$/i.test(raw);
  const isContinuePhrase = !raw || /^(continue|next|listen|go on|more|proceed|yes|ok|okay|copy|understood|understand)\.?$/i.test(raw);

  if (isExplicitConclusion) {
    return concludePersonnelBriefing(run);
  }

  if (isContinuePhrase) {
    if (briefing.current_beat_index < beats.length - 1) {
      briefing.current_beat_index++;
      const nextBeatText = beats[briefing.current_beat_index];
      briefing.exchange_history.push({
        speaker: briefing.speaker,
        speaker_title: briefing.speaker_title,
        text: nextBeatText,
        beat_key: BRIEFING_BEAT_KEYS[briefing.current_beat_index] ?? null,
        listeners: briefingListeners(run, briefing),
        at_interval: Number(run.expedition.clock?.interval ?? 0),
        at: new Date().toISOString()
      });
      presentationBus.emit(run, {
        type: presentationBus.EVENT_TYPES.DIALOGUE,
        source: presentationBus.SOURCES.DETERMINISTIC,
        channel: "LOCAL",
        speaker: briefing.speaker,
        speaker_id: "kirk-maxwell",
        speaker_title: briefing.speaker_title,
        recipient_type: "group",
        recipient_id: "@briefing",
        recipient_name: "Q4 Assignees",
        text: nextBeatText
      });
      return {
        ok: true,
        status: "active",
        beat: opener.beat ?? BEATS.PERSONNEL_BRIEFING,
        reply: nextBeatText,
        briefing
      };
    } else {
      return concludePersonnelBriefing(run);
    }
  }

  // Never fabricate player dialogue: record player's exact words
  briefing.exchange_history.push({
    speaker: "YOU",
    speaker_title: "Assignee · Camera Operator",
    text: raw,
    at: new Date().toISOString()
  });

  presentationBus.emit(run, {
    type: presentationBus.EVENT_TYPES.DIALOGUE,
    source: presentationBus.SOURCES.DETERMINISTIC,
    channel: "LOCAL",
    speaker: "YOU",
    speaker_id: run.session?.startup?.player?.observer_id ?? "player",
    recipient_type: "direct",
    recipient_id: "kirk-maxwell",
    recipient_name: briefing.speaker,
    text: raw
  });

  // This is an authored temporal delivery, not an open FAQ surface: Maxwell does not
  // field free-form questions mid-briefing. Speech-act classification is retained
  // (buildMaxwellWordsmithHints / dialogue-interpretation.js still exists and is used
  // elsewhere), but this call site no longer branches replies off of topic-matching —
  // any input that isn't a recognized continue/conclude phrase gets a single authored
  // deflection back to the authored beats, keeping the briefing on rails.
  const reply = "There isn't time for that right now — let's get through this, and you can ask around once we're done here.";

  briefing.exchange_history.push({
    speaker: briefing.speaker,
    speaker_title: briefing.speaker_title,
    text: reply,
    at: new Date().toISOString()
  });

  presentationBus.emit(run, {
    type: presentationBus.EVENT_TYPES.DIALOGUE,
    source: presentationBus.SOURCES.DETERMINISTIC,
    channel: "LOCAL",
    speaker: briefing.speaker,
    speaker_id: "kirk-maxwell",
    speaker_title: briefing.speaker_title,
    recipient_type: "direct",
    recipient_id: run.session?.startup?.player?.observer_id ?? "player",
    recipient_name: "YOU",
    text: reply
  });

  return {
    ok: true,
    status: "active",
    reply,
    briefing
  };
}

function concludePersonnelBriefing(run) {
  if (!isOpener(run?.scenario)) return { ok: false, code: "NOT_OPENER" };
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  const opener = run.expedition.day1_opener;
  opener.personnel_briefing ??= {};
  const briefing = opener.personnel_briefing;

  briefing.status = "concluded";
  // Maxwell leaves the room when the briefing concludes: recorded once, in simulation time, so later
  // references ("before Maxwell left") can anchor to a canonical event instead of a guess.
  if (!Number.isFinite(Number(briefing.concluded_at_interval))) briefing.concluded_at_interval = Number(run.expedition.clock?.interval ?? 0);
  briefing.exchange_history ??= [];

  const dismissalText = briefing.dialogue?.dismissal || "That's the briefing. Take a few minutes, get acquainted with the people at your table, and report to Equipment Staging when you're ready.";
  const lastTurn = briefing.exchange_history[briefing.exchange_history.length - 1];
  if (!lastTurn || lastTurn.text !== dismissalText) {
    briefing.exchange_history.push({
      speaker: briefing.speaker || "DR. KIRK MAXWELL",
      speaker_title: briefing.speaker_title || "Chief Expedition Briefing Authority · Standard Side",
      text: dismissalText,
      beat_key: "dismissal",
      listeners: briefingListeners(run, briefing),
      at_interval: Number(run.expedition.clock?.interval ?? 0),
      at: new Date().toISOString()
    });
  }

  presentationBus.emit(run, {
    type: presentationBus.EVENT_TYPES.DIALOGUE,
    source: presentationBus.SOURCES.DETERMINISTIC,
    channel: "LOCAL",
    speaker: briefing.speaker || "DR. KIRK MAXWELL",
    text: dismissalText
  });

  opener.beat = BEATS.LOCAL_INTRODUCTIONS;
  opener.esd_handoff ??= {};
  opener.esd_handoff.status = "introductions-open";
  opener.esd_handoff.player_dialogue_input = "local-open";
  opener.esd_handoff.coworker_activity = "active";

  presentationBus.emit(run, {
    type: presentationBus.EVENT_TYPES.INTERPRETATION,
    source: presentationBus.SOURCES.DETERMINISTIC,
    channel: "LOCAL",
    text: "Dr. Maxwell gathers his briefing notes and departs the lower briefing room. Your three coworkers turn toward you."
  });

  return {
    ok: true,
    status: "concluded",
    beat: BEATS.LOCAL_INTRODUCTIONS,
    briefing
  };
}

function advancePersonnelBriefingBeat(run) {
  return interactPersonnelBriefing(run, "continue");
}

module.exports = {
  BRIEFING_AUTHORITY_STATUS,
  BRIEFING_AUTHORITY_PROVENANCE,
  briefingListeners,
  BRIEFING_BEAT_KEYS,
  VERSION,
  SCENARIO,
  RUNTIME_SCENARIO,
  BEATS,
  ONE_SHOT_EVENTS,
  ACTION_DURATIONS_SECONDS,
  validate,
  isOpener,
  isBroadcastStandby,
  isBroadcastActive,
  isBroadcastCompleted,
  startBroadcast,
  completeBroadcast,
  startPersonnelBriefing,
  advancePersonnelBriefingBeat,
  interactPersonnelBriefing,
  concludePersonnelBriefing,
  staffingRules,
  mission,
  instantiate,
  ensureWorldOutpostGeography,
  isOneShotConsumed,
  markOneShotConsumed,
  verifyDelivery,
  verifyReturn,
  writeReport,
  assessInstitutionalRecord,
  logisticsDefinition,
  getActionDuration,
  advanceSimulationTime,
  isCutoffExceeded,
  triggerCatastrophicEnding
};
