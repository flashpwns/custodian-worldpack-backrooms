(function (root, factory) {
  const registry = factory();
  if (typeof module === "object" && module.exports) module.exports = registry;
  root.YBCinematicRegistry = registry;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /**
   * desktop/shared/cinematic-registry.js
   *
   * Section 24: Visual and Cinematic Placeholder Integration Register
   *
   * Provides authoritative runtime slots and replacement contracts for all 14 canonical
   * visual/cinematic placeholders required by the Living Beatmap.
   */

  const CANONICAL_PLACEHOLDER_IDS = Object.freeze([
    "DATE_CARD_JULY_1991",
    "WAIVER_RESPONSIBILITY",
    "ASYNC_BOOT",
    "BRIEFING_FEED_ACQUIRE",
    "BRIEFING_INFORMATIONAL_VIDEO",
    "BRIEFING_FEED_RELEASE",
    "THRESHOLD_ROOM_ENVIRONMENT",
    "THRESHOLD_CROSSING_ENTRY_4",
    "KV31_STATIC_TRANSITION",
    "KV31_BLAST_DOOR_OPEN",
    "THRESHOLD_RETURN_1_TO_4",
    "END_OF_SHIFT_NOTICE",
    "CATASTROPHIC_THRESHOLD_FAILURE",
    "CATASTROPHIC_NEWSPAPER"
  ]);

  const REGISTRY = {
    DATE_CARD_JULY_1991: {
      id: "DATE_CARD_JULY_1991",
      slot: "Beat 1 date card",
      trigger: "New world creation / assignment of Clear Q4",
      completion_contract: "Non-interactive 5-second fade in and 5-second fade out from black; automatically advances to BRIEFING_INFORMATIONAL_VIDEO.",
      interruption_policy: "Reloading during date card restarts at Beat 1 date card cleanly without world corruption.",
      save_boundary: "World seed and base creation committed; player character identity not yet committed.",
      fallback: {
        type: "typography",
        background: "#000000",
        primary_text: "JULY, 1991",
        qualifier_text: null,
        gate_inputs_required: 0,
        duration_seconds: 10
      },
      asset_interface: {
        asset_id: "cinematic.date_card_july_1991",
        format: "video/quicktime",
        is_final: false,
        resolved_path: null
      }
    },

    WAIVER_RESPONSIBILITY: {
      id: "WAIVER_RESPONSIBILITY",
      slot: "Beat 1 waiver",
      trigger: "Completion of BRIEFING_INFORMATIONAL_VIDEO",
      completion_contract: "Entry, name interaction, identity commit, and exit remain independently functional.",
      interruption_policy: "Reloading before name confirmation returns to unfiled waiver; reloading after name confirmation resumes with committed identity.",
      save_boundary: "Player character record committed to world.characters upon explicit review and confirmation.",
      fallback: {
        type: "interactive_document",
        document_title: "ASYNC_Project_KV31_Waiver_of_Responsibility",
        header: "ASYNC RESEARCH INSTITUTE · PERSONNEL DIVISION",
        title: "PERSONNEL IDENTITY WAIVER",
        input_order: "LAST_FIRST",
        fields: ["last_name", "first_name"]
      },
      asset_interface: {
        asset_id: "cinematic.waiver_responsibility",
        format: "document/svg+html",
        is_final: false,
        resolved_path: null
      }
    },

    ASYNC_BOOT: {
      id: "ASYNC_BOOT",
      slot: "Beat 1 terminal boot",
      trigger: "Confirmation of player identity waiver and paper exit",
      completion_contract: "Sequential 0 to 100% deterministic 2-second progression per subsystem, leading into AEOT UI cold boot.",
      interruption_policy: "Reopening during boot safely re-evaluates operational shell initialization without duplicating session state.",
      save_boundary: "Session entry created in desktop saves; phase set to BRIEFING.",
      fallback: {
        type: "terminal_stages",
        header: "ASYNC EXPEDITION OPERATIONS TERMINAL",
        title: "STAGED INITIALIZATION",
        stages: [
          "SUBSYSTEM BUS VERIFICATION",
          "CLEARANCE VERIFICATION: Q4",
          "SUB-LEVEL TELEMETRY LINK",
          "FACILITY SCHEMATIC: SECTOR B1"
        ]
      },
      asset_interface: {
        asset_id: "cinematic.async_boot",
        format: "text/terminal",
        is_final: false,
        resolved_path: null
      }
    },

    BRIEFING_FEED_ACQUIRE: {
      id: "BRIEFING_FEED_ACQUIRE",
      slot: "Beat 2 map-to-projector transition (superseded)",
      trigger: "Superseded by pre-waiver introductory video",
      completion_contract: "Superseded in Pass 3.10; retained for registry schema integrity.",
      interruption_policy: "Party remains in briefing room; canonical coordinates unchanged.",
      save_boundary: "Phase remains BRIEFING; no spatial mutation committed.",
      fallback: {
        type: "feed_cut",
        source_view: "facility_map",
        target_view: "projector_feed",
        label: "FEED ACQUIRE · PROJECTOR 01"
      },
      asset_interface: {
        asset_id: "cinematic.briefing_feed_acquire",
        format: "video/feed_cut",
        is_final: false,
        resolved_path: null
      }
    },

    BRIEFING_INFORMATIONAL_VIDEO: {
      id: "BRIEFING_INFORMATIONAL_VIDEO",
      slot: "Beat 1 introductory institutional video",
      trigger: "Fade-out completion of DATE_CARD_JULY_1991",
      completion_contract: "Playback completion automatically proceeds into WAIVER_RESPONSIBILITY.",
      interruption_policy: "Reloading during introductory video restarts at Beat 1 date card cleanly without world corruption.",
      save_boundary: "World file already established; player identity uncommitted.",
      fallback: {
        type: "placeholder_media_hook",
        duration_seconds: 2
      },
      asset_interface: {
        asset_id: "cinematic.briefing_informational_video",
        format: "video/mp4",
        is_final: false,
        resolved_path: null
      }
    },

    BRIEFING_FEED_RELEASE: {
      id: "BRIEFING_FEED_RELEASE",
      slot: "Beat 2 projector-to-map transition (superseded)",
      trigger: "Superseded by pre-waiver introductory video",
      completion_contract: "Superseded in Pass 3.10; retained for registry schema integrity.",
      interruption_policy: "Emits Maxwell speech event exactly once; reload does not duplicate speech events.",
      save_boundary: "Maxwell briefing broadcast recorded in presentation_bus.",
      fallback: {
        type: "feed_restore",
        source_view: "projector_feed",
        target_view: "facility_map",
        label: "FEED RELEASE · RESTORING FACILITY SCHEMATIC"
      },
      asset_interface: {
        asset_id: "cinematic.briefing_feed_release",
        format: "video/feed_cut",
        is_final: false,
        resolved_path: null
      }
    },

    THRESHOLD_ROOM_ENVIRONMENT: {
      id: "THRESHOLD_ROOM_ENVIRONMENT",
      slot: "Beat 5 centerpiece environment",
      trigger: "Party arrives at Threshold approach / staging chamber",
      completion_contract: "Reads fixed canonical room geometry and does not generate an alternate location.",
      interruption_policy: "Party location remains threshold-approach; coordinates and acoustics preserved across reload.",
      save_boundary: "Phase set to THRESHOLD; player_location set to threshold-approach.",
      fallback: {
        type: "environmental_scene",
        room_name: "Threshold Chamber Approach",
        warning_signage: "WARNING / HIGH MAGNETIC FIELD / AUTHORIZED PERSONNEL ONLY",
        features: [
          "Massive concrete portal frame with electromagnetic emitter arrays",
          "Threshold observation window on upper gallery",
          "Yellow-painted perimeter boundary line"
        ]
      },
      asset_interface: {
        asset_id: "cinematic.threshold_room_environment",
        format: "environment/3d_scene",
        is_final: false,
        resolved_path: null
      }
    },

    THRESHOLD_CROSSING_ENTRY_4: {
      id: "THRESHOLD_CROSSING_ENTRY_4",
      slot: "Beat 6 four-person entry",
      trigger: "Execution of CROSS action following successful radio check",
      completion_contract: "Represents simulation-owned movement; interruption and reload cannot duplicate personnel.",
      interruption_policy: "Party members transition atomically to utility-room; reload never splits or duplicates coworkers.",
      save_boundary: "Player location updated to utility-room; phase transitioned to FIELD_OPERATION.",
      fallback: {
        type: "traversal_sequence",
        source_location: "threshold-approach",
        destination_location: "utility-room",
        actors: ["player", "coworker1", "coworker2", "coworker3"],
        label: "THRESHOLD CROSSING SEQUENCE · PARTY 4"
      },
      asset_interface: {
        asset_id: "cinematic.threshold_crossing_entry_4",
        format: "cinematic/sequence",
        is_final: false,
        resolved_path: null
      }
    },

    KV31_STATIC_TRANSITION: {
      id: "KV31_STATIC_TRANSITION",
      slot: "Beat 6 KV31 reveal",
      trigger: "Threshold crossing aperture boundary traversal",
      completion_contract: "Preserves party, equipment, time, and current transition state.",
      interruption_policy: "Radio interference and visual static resolve deterministically into the Complex acoustics and utility room visuals.",
      save_boundary: "Simulation clock advances by traversal duration (2 minutes); equipment custody verified.",
      fallback: {
        type: "static_burst",
        duration_ms: 1200,
        audio_cue: "threshold_static_burst",
        visual_effect: "crt_horizontal_tear"
      },
      asset_interface: {
        asset_id: "cinematic.kv31_static_transition",
        format: "effect/shader",
        is_final: false,
        resolved_path: null
      }
    },

    KV31_BLAST_DOOR_OPEN: {
      id: "KV31_BLAST_DOOR_OPEN",
      slot: "Beat 6 and Beat 9 door cycle",
      trigger: "Initial egress into Complex (Beat 6) and return to KV31 (Beat 9)",
      completion_contract: "Door state and elapsed time come from the simulation; visual completion acknowledges them.",
      interruption_policy: "Door state is deterministic based on run.spatial state; reloading maintains correct open/closed status.",
      save_boundary: "Portal state updated in run.spatial connections.",
      fallback: {
        type: "door_animation",
        door_id: "kv31-blast-door",
        state: "open",
        audio_bed: "hydraulic_heavy_open",
        travel_duration_ms: 3000
      },
      asset_interface: {
        asset_id: "cinematic.kv31_blast_door_open",
        format: "animation/door_cycle",
        is_final: false,
        resolved_path: null
      }
    },

    THRESHOLD_RETURN_1_TO_4: {
      id: "THRESHOLD_RETURN_1_TO_4",
      slot: "Beat 9 contextual return",
      trigger: "Execution of COMPLETE_RETURN following visual surveillance confirmation",
      completion_contract: "Variant receives the canonical extraction snapshot and cannot add absent personnel.",
      interruption_policy: "Only returned personnel are registered as returned; casualties/absent personnel remain accounted for accurately.",
      save_boundary: "Run lifecycle marked completed; phase set to REPORT.",
      fallback: {
        type: "contextual_return",
        surveillance_verified: true,
        returned_personnel: "canonical_snapshot",
        egress_point: "threshold-side-entry",
        label: "THRESHOLD INTAKE & DECONTAMINATION"
      },
      asset_interface: {
        asset_id: "cinematic.threshold_return_1_to_4",
        format: "cinematic/contextual",
        is_final: false,
        resolved_path: null
      }
    },

    END_OF_SHIFT_NOTICE: {
      id: "END_OF_SHIFT_NOTICE",
      slot: "Beat 10 normal terminus",
      trigger: "Submission of Written Expedition Report during normal Day One completion",
      completion_contract: "Loads persistent AEOT inspection state; no automatic title redirect.",
      interruption_policy: "Reopening world directly loads persistent AEOT inspection state with all 6 record views inspectable.",
      save_boundary: "World committed review archived in world.q4_reviews; session debrief persisted.",
      fallback: {
        type: "end_of_shift_display",
        title: "END OF SHIFT",
        date: "JULY 17, 1991",
        record_status: "EXPEDITION RECORD COMMITTED",
        assignment_status: "NO FURTHER ASSIGNMENT ISSUED",
        records_status: "AEOT RECORDS REMAIN AVAILABLE",
        prose: "END OF SHIFT\nJULY 17, 1991\nEXPEDITION RECORD COMMITTED\nNO FURTHER ASSIGNMENT ISSUED\nAEOT RECORDS REMAIN AVAILABLE"
      },
      asset_interface: {
        asset_id: "cinematic.end_of_shift_notice",
        format: "card/html",
        is_final: false,
        resolved_path: null
      }
    },

    CATASTROPHIC_THRESHOLD_FAILURE: {
      id: "CATASTROPHIC_THRESHOLD_FAILURE",
      slot: "Post-1:00 PM ending",
      trigger: "Attempted return to Threshold after 1:00 PM operational cutoff",
      completion_contract: "Commits the terminal trapped state once before presentation advances.",
      interruption_policy: "World marked terminal with outcome catastrophic-failure; cold reboot preserves locked trapped outcome.",
      save_boundary: "world.q4_operations.terminal_outcome committed once with outcome: catastrophic-failure.",
      fallback: {
        type: "threshold_aperture_collapse",
        status: "dead",
        error_code: "THRESHOLD_NONFUNCTIONAL",
        reason: "The Threshold apparatus is completely dark and unresponsive. The aperture has collapsed. Operational cutoff exceeded."
      },
      asset_interface: {
        asset_id: "cinematic.catastrophic_threshold_failure",
        format: "cinematic/collapse",
        is_final: false,
        resolved_path: null
      }
    },

    CATASTROPHIC_NEWSPAPER: {
      id: "CATASTROPHIC_NEWSPAPER",
      slot: "Catastrophic final image",
      trigger: "Post-1:00 PM operational cutoff collapse sequence conclusion",
      completion_contract: "Uses project-owner final media later; completion returns to title with terminal state preserved.",
      interruption_policy: "Reopening world displays terminal catastrophic record without permitting further gameplay.",
      save_boundary: "Persisted in world.q4_operations.terminal_outcome.",
      fallback: {
        type: "newspaper_placeholder",
        is_final_artwork: false,
        note: "Project owner will supply completed visual. Temporary headline and artwork are development placeholders.",
        headline: "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA",
        location: "Santa Clarita",
        date: "JULY 17, 1991",
        casualties: 4,
        return_to_title_required: true
      },
      asset_interface: {
        asset_id: "ending.catastrophic.newspaper",
        format: "image/png",
        is_final: false,
        resolved_path: null
      }
    }
  };

  function getPlaceholder(id) {
    const entry = REGISTRY[id];
    if (!entry) return null;
    return JSON.parse(JSON.stringify(entry));
  }

  function listPlaceholders() {
    return CANONICAL_PLACEHOLDER_IDS.map((id) => getPlaceholder(id));
  }

  function isRegistered(id) {
    return CANONICAL_PLACEHOLDER_IDS.includes(id);
  }

  function registerAsset(id, assetPath) {
    if (!isRegistered(id)) throw new Error("Unknown cinematic placeholder identifier: " + id);
    REGISTRY[id].asset_interface.resolved_path = assetPath;
    REGISTRY[id].asset_interface.is_final = true;
    return JSON.parse(JSON.stringify(REGISTRY[id]));
  }

  const DEFAULT_AUTHORED_ASSETS = Object.freeze({
    DATE_CARD_JULY_1991: "../assets/video/DateCardNewPlayerClip.mov",
    BRIEFING_INFORMATIONAL_VIDEO: "../assets/video/IntroductoryVideoVotT.mov",
    THRESHOLD_CROSSING_ENTRY_4: "../assets/video/CrossingIntoTheComplex.mov"
  });

  function getResolvedPath(id) {
    if (REGISTRY[id]?.asset_interface?.is_final && REGISTRY[id]?.asset_interface?.resolved_path) {
      return REGISTRY[id].asset_interface.resolved_path;
    }
    return DEFAULT_AUTHORED_ASSETS[id] || null;
  }

  function registerDefaultAuthoredAssets() {
    for (const [id, assetPath] of Object.entries(DEFAULT_AUTHORED_ASSETS)) {
      registerAsset(id, assetPath);
    }
  }

  return {
    CANONICAL_PLACEHOLDER_IDS,
    REGISTRY,
    DEFAULT_AUTHORED_ASSETS,
    getPlaceholder,
    listPlaceholders,
    isRegistered,
    registerAsset,
    getResolvedPath,
    registerDefaultAuthoredAssets
  };
});
