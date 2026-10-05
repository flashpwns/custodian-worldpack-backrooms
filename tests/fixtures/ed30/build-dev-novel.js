"use strict";

// ED-30 DEV set for the end-to-end pipeline (tunable; never a held-out set). Paraphrases and typos that no
// Tier-1 cue is written for, and echo follow-ups that pick up a word the last reply actually used. Written
// for development from the class descriptions only.
//
//   node tests/fixtures/ed30/build-dev-novel.js   -> dev-novel.jsonl

const fs = require("node:fs");
const path = require("node:path");

const C = {
  "0": { phase: "introductions" },
  // echo contexts: the NPC line is what was actually spoken; the prior player line is the request it answered
  Mcase: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "What's in the duffle, Malcolm?", last_npc_line: "Couldn't tell you. The case is sealed." },
  Gscared: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Giselle, are you nervous?", last_npc_line: "Honestly? I'm terrified of going in." },
  Grole: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Giselle, what do you do?", last_npc_line: "I watch and remember things. It's harder than it sounds." },
  Tdest: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Where are we headed?", last_npc_line: "Outpost A, the Bermuda branch." },
  Ttenure: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, how long have you been with ASYNC?", last_npc_line: "Years now. It feels like forever." },
  Mnext: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "What's next?", last_npc_line: "Equipment Staging, once we've all met." }
};
const ALL = ["Giselle", "Malcolm", "Tonya"];

// [utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, relation, cardinality, temporal, should_clarify]
const ROWS = [
  // paraphrases of the objective / next step / destination
  ["so what's the gig today", "0", "question", "wh", "untargeted", [], "mission.objective", "new", "one_spokesperson", "today", false],
  ["what are we actually here for", "0", "question", "wh", "untargeted", [], "mission.objective", "new", "one_spokesperson", null, false],
  ["where do we go once this is done", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  ["where r we supposed to show up after this", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  ["what's our final stop", "0", "question", "wh", "untargeted", [], "mission.destination", "new", "one_spokesperson", null, false],
  // items
  ["who's lugging the duffle around", "0", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["what's the spectrometer even for", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["whats inside that bag", "0", "question", "wh", "untargeted", [], "item.contents", "new", "one_spokesperson", null, false],
  // people
  ["how long's everyone been at async", "0", "question", "wh", "group", ALL, "person.async_tenure", "new", "each_self", null, false],
  ["Tonya, what's your line of work", "0", "question", "wh", "explicit", ["Tonya"], "person.role", "new", "each_self", null, false],
  ["anybody here done one of these trips before", "0", "question", "yes_no", "group", ALL, "person.expedition_experience", "new", "each_self", "ever", false],
  ["Malcolm, you holding up ok", "0", "question", "declarative", "explicit", ["Malcolm"], "person.wellbeing", "new", "each_self", "now", false],
  // typos
  ["whos in charg of the camra", "0", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["waht is the threshhold", "0", "question", "wh", "untargeted", [], "place.definition", "new", "one_spokesperson", null, false],
  // echo follow-ups: a word the reply used, questioned
  ["Sealed how?", "Mcase", "question", "wh", "inherited", ["Malcolm"], "item.contents", "continuation", "one_spokesperson", null, false],
  ["sealed??", "Mcase", "question", "yes_no", "inherited", ["Malcolm"], "item.contents", "continuation", "one_spokesperson", null, false],
  ["Terrified of what?", "Gscared", "question", "wh", "inherited", ["Giselle"], "person.nervousness", "continuation", "each_self", "now", false],
  ["harder how", "Grole", "question", "wh", "inherited", ["Giselle"], "person.role", "continuation", "each_self", null, false],
  ["the Bermuda branch?", "Tdest", "question", "yes_no", "inherited", ["Tonya"], "mission.destination", "continuation", "one_spokesperson", null, false],
  ["forever?", "Ttenure", "question", "yes_no", "inherited", ["Tonya"], "person.async_tenure", "continuation", "each_self", null, false],
  ["once we've all met?", "Mnext", "question", "yes_no", "inherited", ["Malcolm"], "procedure.next_incomplete_step", "continuation", "one_spokesperson", null, false],
  // not echoes: a fresh question that happens to share a word stays fresh
  ["Who has the case?", "Mcase", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false]
];

const lines = ROWS.map(([utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify], i) => JSON.stringify({ id: `n${String(i + 1).padStart(3, "0")}`, context: { phase: "introductions", active_speaker: null, last_npc_line: null, last_player_line: null, active_activity: null, activity_done: [], pending_unanswered_request: null, ...C[ctx] }, utterance, expected: { speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify } }));
fs.writeFileSync(path.join(__dirname, "dev-novel.jsonl"), `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} novel dev items`);
