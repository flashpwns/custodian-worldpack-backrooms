"use strict";

// ED-30H DEV set (tunable; never held out). Written from the four general classes only: Tier-1
// over-confidence, item question roles, discourse-linked commentary / answers to a coworker's question, and
// short fragments read against the conversation state.
//
//   node tests/fixtures/ed30/build-dev-h.js   -> dev-h.jsonl

const fs = require("node:fs");
const path = require("node:path");

const C = {
  "0": {},
  TEN: { active_speaker: "Malcolm", last_player_line: "Malcolm, how long have you been with ASYNC?", last_npc_line: "A few months now." },
  EXP: { active_speaker: "Tonya", last_player_line: "Tonya, have you been in the Complex before?", last_npc_line: "A couple of times, yes." },
  CAM: { active_speaker: "Giselle", last_player_line: "Who has the camera?", last_npc_line: "You've got it." },
  ASKYN: { active_speaker: "Tonya", last_player_line: "Tonya, how are you?", last_npc_line: "Fine. Have you been on one of these before?" },
  ASKWH: { active_speaker: "Giselle", last_player_line: "Giselle, what do you do?", last_npc_line: "Observation, mostly. What do you do?" },
  ROUND: { active_speaker: "Tonya", last_player_line: "Tonya, you first.", last_npc_line: "Yes, I've been in.", active_activity: "EXPERIENCE_ROUND", activity_done: ["Tonya"] },
  TWO: { active_speaker: "Malcolm", last_player_line: "Malcolm, is it your first day?", last_npc_line: "No, a few months.", pending_unanswered_request: "Where are we going?" }
};
const ALL = ["Giselle", "Malcolm", "Tonya"];
// [utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, relation, cardinality, temporal, should_clarify]
const ROWS = [
  // item roles (minimal pairs: only the relation word changes)
  ["what is the lamp", "0", "question", "wh", "untargeted", [], "item.definition", "new", "one_spokesperson", null, false],
  ["what's the lamp for", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["what's the lamp used for", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["what does the lamp do", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["who has the lamp", "0", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["where's the lamp", "0", "question", "wh", "untargeted", [], "item.location", "new", "one_spokesperson", null, false],
  ["where'd the lamp come from", "0", "question", "wh", "untargeted", [], "item.provenance", "new", "one_spokesperson", null, false],
  ["why are we hauling the spectrometer around", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  // over-confident statements that are really asked
  ["camera's still on you", "CAM", "question", "declarative", "inherited", ["Giselle"], "item.holder", "continuation", "one_spokesperson", null, false],
  ["we report where after this", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  ["a few months huh", "TEN", "question", "yes_no", "inherited", ["Malcolm"], "person.async_tenure", "continuation", "each_self", null, false],
  ["heyyy all", "0", "greeting", null, "group", ALL, null, "new", "each_ack", null, false],
  ["ok see yall at staging", "0", "farewell", null, "group", ALL, null, "new", "each_ack", null, false],
  // commentary-prefixed continuation
  ["huh ok, and before that", "EXP", "question", "wh", "inherited", ["Tonya"], "person.complex_experience", "continuation", "each_self", "ever", false],
  ["wow alright, since when", "TEN", "question", "wh", "inherited", ["Malcolm"], "person.async_tenure", "continuation", "each_self", null, false],
  ["cool cool, and giselle?", "TEN", "elliptical_continuation", "wh", "explicit", ["Giselle"], "person.async_tenure", "continuation", "each_self", null, false],
  ["yeah no, i meant the lamp", "CAM", "repair", null, "inherited", ["Giselle"], "item.holder", "repair", "one_spokesperson", null, false],
  // answers to a coworker's question
  ["nah first time", "ASKYN", "answer", null, "inherited", ["Tonya"], null, "answer", "none", null, false],
  ["i'm on camera duty", "ASKWH", "answer", null, "inherited", ["Giselle"], null, "answer", "none", null, false],
  ["honestly no clue", "ASKYN", "answer", null, "inherited", ["Tonya"], null, "answer", "none", null, false],
  ["i'd rather not get into it", "ASKWH", "answer", null, "inherited", ["Giselle"], null, "answer", "none", null, false],
  ["why do you wanna know", "ASKYN", "question", "wh", "inherited", ["Tonya"], "conversation.explanation", "continuation", "one_spokesperson", null, false],
  // short fragments against the state
  ["since when", "TEN", "question", "wh", "inherited", ["Malcolm"], "person.async_tenure", "continuation", "each_self", null, false],
  ["ever", "EXP", "question", "yes_no", "inherited", ["Tonya"], "person.complex_experience", "continuation", "each_self", "ever", false],
  ["which one", "0", "question", "wh", "untargeted", [], null, "new", "one_spokesperson", null, true],
  ["and you?", "ROUND", "elliptical_continuation", "wh", "inherited", [], "person.complex_experience", "continuation", "each_self", "ever", true]
];
const lines = ROWS.map(([utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify], i) => JSON.stringify({ id: `h${String(i + 1).padStart(3, "0")}`, context: { phase: "introductions", active_speaker: null, last_npc_line: null, last_player_line: null, active_activity: null, activity_done: [], pending_unanswered_request: null, ...C[ctx] }, utterance, expected: { speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify } }));
fs.writeFileSync(path.join(__dirname, "dev-h.jsonl"), `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} ED-30H dev items`);
