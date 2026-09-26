"use strict";

// ED-30 DEV corpus (tunable). Writes dev-corpus.jsonl in the held-out schema. Scene: the player and three
// coworkers (Giselle = first-day observer on verbal recall, Malcolm = intern courier with the startup
// materials, Tonya = veteran doctor on the layout record) after Maxwell's briefing.
//
//   node tests/fixtures/ed30/build-dev-corpus.js

const fs = require("node:fs");
const path = require("node:path");

const C = {
  "0": { phase: "introductions" },
  G: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Is this your first day, Giselle?", last_npc_line: "Yeah, it's my first day." },
  Gcx: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Does anyone know what the Complex is?", last_npc_line: "The Complex is the environment our expedition operates in." },
  Gw: { phase: "introductions", active_speaker: "Giselle", last_player_line: "How are you doing, Giselle?", last_npc_line: "Doing all right, thanks." },
  Ti: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, tell me about yourself.", last_npc_line: "I'm Tonya, a field medical doctor. I'm compiling the layout record.", active_activity: "SELF_INTRODUCTION_ROUND", activity_done: ["Tonya"] },
  Gi: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Could you introduce yourself?", last_npc_line: "I'm Giselle, a field researcher. I'm handling observation and verbal recall." },
  P: { phase: "introductions", pending_unanswered_request: "Are we all going together?" },
  Pc: { phase: "introductions", pending_unanswered_request: "Who has the camera?" },
  Md: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "Where are we going?", last_npc_line: "Maxwell said the startup materials are going to Outpost A." },
  Mx: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "Malcolm, have you done this before?", last_npc_line: "No, first one for me." },
  Tn: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, are you nervous?", last_npc_line: "Not especially." },
  S: { phase: "equipment_staging" },
  GQ: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Who has the thing?", last_npc_line: "Sorry, which thing do you mean?" },
  // ED-30 generalisation classes (repair fillers, group repairs, attention with a pending question, round-taking,
  // item/sequence ellipsis): new phrasings written for the dev set, not taken from any held-out item.
  MfD: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "Malcolm, is it your first day?", last_npc_line: "No, a few months." },
  Tf: { phase: "introductions", active_speaker: "Tonya", last_player_line: "How are you feeling?", last_npc_line: "Fine." },
  GdM: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Malcolm, what's in the duffle?", last_npc_line: "No idea." },
  MxC: { phase: "introductions", active_speaker: "Malcolm", last_player_line: "Has anyone been in the Complex?", last_npc_line: "Never." },
  PnM: { phase: "introductions", last_player_line: "Malcolm, where's the duffle going?", pending_unanswered_request: "Malcolm, where's the duffle going?" },
  XR2: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, you first.", last_npc_line: "Yes, I've been in.", active_activity: "EXPERIENCE_ROUND", activity_done: ["Tonya"] },
  Hc: { phase: "introductions", active_speaker: "Giselle", last_player_line: "Who has the camera?", last_npc_line: "You've got it." },
  Tw: { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, what's next?", last_npc_line: "We report to Equipment Staging." }
};
const ALL = ["Giselle", "Malcolm", "Tonya"];

// [utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, relation, cardinality, temporal, should_clarify]
const ROWS = [
  // greetings / social
  ["Hello everyone!", "0", "greeting", null, "group", ALL, null, "new", "each_ack", null, false],
  ["morning all", "0", "greeting", null, "group", ALL, null, "new", "each_ack", null, false],
  ["Hey Tonya", "0", "greeting", null, "explicit", ["Tonya"], null, "new", "each_ack", null, false],
  ["Good morning, Malcolm.", "0", "greeting", null, "explicit", ["Malcolm"], null, "new", "each_ack", null, false],
  ["Hi, I'm Jack, I'll be leading today.", "0", "self_introduction", null, "untargeted", [], null, "new", "each_ack", null, false],
  ["Good to hear!", "Gw", "social_acknowledgment", null, "untargeted", [], null, "new", "none", null, false],
  ["Interesting.", "Gcx", "social_acknowledgment", null, "untargeted", [], null, "new", "none", null, false],
  ["thanks", "Gi", "thanks", null, "untargeted", [], null, "new", "none", null, false],
  ["Well, this seems incredibly safe.", "0", "sarcasm", null, "untargeted", [], null, "new", "one_spokesperson", null, false],
  ["what could possibly go wrong lol", "0", "sarcasm", null, "untargeted", [], null, "new", "one_spokesperson", null, false],
  // first day / tenure
  ["Is it everyone's first day here, at Async, today? Or just myself.", "0", "question", "choice", "group", ALL, "person.first_day_at_async", "new", "each_self", "today", false],
  ["is this your first day tonya", "0", "question", "yes_no", "explicit", ["Tonya"], "person.first_day_at_async", "new", "each_self", "today", false],
  ["First day here, Malcolm?", "0", "question", "declarative", "explicit", ["Malcolm"], "person.first_day_at_async", "new", "each_self", "today", false],
  ["You new here, Giselle?", "0", "question", "declarative", "explicit", ["Giselle"], "person.first_day_at_async", "new", "each_self", null, false],
  ["are you all new?", "0", "question", "yes_no", "group", ALL, "person.first_day_at_async", "new", "each_self", null, false],
  ["Have you worked here before, Tonya?", "0", "question", "yes_no", "explicit", ["Tonya"], "person.async_tenure", "new", "each_self", "ever", false],
  ["how long have you been with async?", "Gw", "question", "wh", "inherited", ["Giselle"], "person.async_tenure", "continuation", "each_self", null, false],
  ["How long have you all been at ASYNC?", "0", "question", "wh", "group", ALL, "person.async_tenure", "new", "each_self", null, false],
  ["Is anyone else new, or is it just me?", "0", "question", "choice", "group", ALL, "person.first_day_at_async", "new", "each_self", null, false],
  // experience
  ["So youve been there before? this, complex?", "Gcx", "question", "declarative", "inherited", ["Giselle"], "person.complex_experience", "continuation", "each_self_concise", "ever", false],
  ["Have any of you been inside before?", "0", "question", "yes_no", "group", ALL, "person.complex_experience", "new", "each_self_concise", "ever", false],
  ["Been in the Complex before, Tonya?", "0", "question", "declarative", "explicit", ["Tonya"], "person.complex_experience", "new", "each_self_concise", "ever", false],
  ["Is this your first time going in, Malcolm?", "0", "question", "yes_no", "explicit", ["Malcolm"], "person.complex_experience", "new", "each_self_concise", "ever", false],
  ["you done this before malcolm", "0", "question", "declarative", "explicit", ["Malcolm"], "person.expedition_experience", "new", "each_self_concise", "ever", false],
  ["Have you ever been on an expedition, Giselle?", "0", "question", "yes_no", "explicit", ["Giselle"], "person.expedition_experience", "new", "each_self_concise", "ever", false],
  ["I meant the Complex.", "Mx", "repair", null, "inherited", ["Malcolm"], "person.complex_experience", "repair", "each_self_concise", "ever", false],
  ["Has anyone here been through the Threshold?", "0", "question", "yes_no", "group", ALL, "person.complex_experience", "new", "each_self_concise", "ever", false],
  // wellbeing / feelings
  ["How are you doing this morning Giselle?", "0", "question", "wh", "explicit", ["Giselle"], "person.wellbeing", "new", "each_self", "now", false],
  ["Good to hear! How about you two, Malcolm, and Tonya?", "Gw", "elliptical_continuation", "wh", "explicit", ["Malcolm", "Tonya"], "person.wellbeing", "continuation", "each_self", "now", false],
  ["How about you two?", "Gw", "elliptical_continuation", "wh", "subset", ["Malcolm", "Tonya"], "person.wellbeing", "continuation", "each_self", "now", false],
  ["And you, Tonya?", "Gw", "elliptical_continuation", "wh", "explicit", ["Tonya"], "person.wellbeing", "continuation", "each_self", "now", false],
  ["What about the rest of you?", "Gw", "elliptical_continuation", "wh", "subset", ["Malcolm", "Tonya"], "person.wellbeing", "continuation", "each_self", "now", false],
  ["how's everyone doing", "0", "question", "wh", "group", ALL, "person.wellbeing", "new", "each_self", "now", false],
  ["You guys doing okay?", "0", "question", "declarative", "group", ALL, "person.wellbeing", "new", "each_self", "now", false],
  ["Are you all looking forward to doing whatever it is were actually supposed to do in there?", "0", "question", "yes_no", "group", ALL, "person.anticipation", "new", "each_self", "now", false],
  ["Excited?", "Gw", "question", "declarative", "inherited", ["Giselle"], "person.anticipation", "continuation", "each_self", "now", false],
  ["Nervous, Tonya?", "0", "question", "declarative", "explicit", ["Tonya"], "person.nervousness", "new", "each_self", "now", false],
  ["are you nervous at all", "Gw", "question", "yes_no", "inherited", ["Giselle"], "person.nervousness", "continuation", "each_self", "now", false],
  ["Anyone else feeling nervous?", "0", "question", "declarative", "group", ALL, "person.nervousness", "new", "each_self", "now", false],
  ["You tired, Malcolm?", "0", "question", "declarative", "explicit", ["Malcolm"], "person.fatigue", "new", "each_self", "now", false],
  ["Why?", "Tn", "question", "wh", "inherited", ["Tonya"], "conversation.explanation", "continuation", "one_spokesperson", null, false],
  ["What makes you say that?", "Tn", "question", "wh", "inherited", ["Tonya"], "conversation.explanation", "continuation", "one_spokesperson", null, false],
  ["Same question, Malcolm.", "Tn", "elliptical_continuation", null, "explicit", ["Malcolm"], "person.nervousness", "continuation", "each_self", "now", false],
  // self description / roles / activities
  ["Interesting. Tonya, can you tell me a bit about yourself?", "Gcx", "request", null, "explicit", ["Tonya"], "person.self_description", "new", "each_self", null, false],
  ["Tonya, tell me about yourself", "0", "request", null, "explicit", ["Tonya"], "person.self_description", "new", "each_self", null, false],
  ["Could you tell me about yourself, Tonya?", "0", "request", null, "explicit", ["Tonya"], "person.self_description", "new", "each_self", null, false],
  ["Mind introducing yourselves?", "0", "request", null, "group", ALL, "person.self_description", "new", "each_self", null, false],
  ["Malcolm, your turn", "Ti", "elliptical_continuation", null, "explicit", ["Malcolm"], "person.self_description", "continuation", "each_self", null, false],
  ["Your turn, Giselle.", "Ti", "elliptical_continuation", null, "explicit", ["Giselle"], "person.self_description", "continuation", "each_self", null, false],
  ["Giselle, you're up.", "Ti", "elliptical_continuation", null, "explicit", ["Giselle"], "person.self_description", "continuation", "each_self", null, false],
  ["I'd love to hear about you, Malcolm.", "0", "request", null, "explicit", ["Malcolm"], "person.self_description", "new", "each_self", null, false],
  ["Tonya, tell me about Malcolm.", "0", "request", null, "explicit", ["Tonya"], "person.identity", "new", "one_spokesperson", null, false],
  ["Tonya told me about Malcolm.", "0", "statement", null, "untargeted", [], null, "new", "one_spokesperson", null, false],
  ["What do you do, Malcolm?", "0", "question", "wh", "explicit", ["Malcolm"], "person.current_assignment", "new", "each_self", null, false],
  ["Who is Maxwell?", "0", "question", "wh", "untargeted", [], "person.identity", "new", "one_spokesperson", null, false],
  ["who's kirk anyway", "0", "question", "wh", "untargeted", [], "person.identity", "new", "one_spokesperson", null, false],
  ["Do you two know each other?", "Gw", "question", "yes_no", "subset", ["Malcolm", "Tonya"], "person.familiarity", "new", "each_self", null, false],
  ["Have you all met before?", "0", "question", "yes_no", "group", ALL, "person.familiarity", "new", "each_self", "ever", false],
  // repairs / attention
  ["I was speaking to Tonya", "Gi", "repair", null, "explicit", ["Tonya"], "person.self_description", "repair", "each_self", null, false],
  ["I was asking Malcolm.", "Gi", "repair", null, "explicit", ["Malcolm"], "person.self_description", "repair", "each_self", null, false],
  ["No, I meant Malcolm.", "Gi", "repair", null, "explicit", ["Malcolm"], "person.self_description", "repair", "each_self", null, false],
  ["I asked if we were all going there together", "P", "repair", null, "group", ALL, "transition.participants", "repair", "one_spokesperson", null, false],
  ["That's not what I asked.", "Md", "repair", null, "inherited", ["Malcolm"], "mission.destination", "repair", "one_spokesperson", null, false],
  ["You didn't answer me.", "P", "repair", null, "group", ALL, "transition.participants", "repair", "one_spokesperson", null, false],
  ["Hello?", "P", "attention_call", null, "group", ALL, "transition.participants", "attention", "one_spokesperson", null, false],
  ["anyone?", "Pc", "attention_call", null, "group", ALL, "item.holder", "attention", "one_knower", null, false],
  ["Hello?", "0", "attention_call", null, "untargeted", [], null, "attention", "one_spokesperson", null, false],
  ["Tonya?", "0", "attention_call", null, "explicit", ["Tonya"], null, "attention", "one_spokesperson", null, false],
  ["Tonya?", "Pc", "attention_call", null, "explicit", ["Tonya"], "item.holder", "attention", "one_spokesperson", null, false],
  // mission / procedure / participants
  ["Interesting. Does anyone know anything about where were going?", "0", "question", "indirect", "group", ALL, "mission.destination", "new", "one_knower", null, false],
  ["Where are we headed?", "0", "question", "wh", "untargeted", [], "mission.destination", "new", "one_spokesperson", null, false],
  ["where to", "0", "question", "wh", "untargeted", [], "mission.destination", "new", "one_spokesperson", null, false],
  ["Where are they sending us?", "0", "question", "wh", "untargeted", [], "mission.destination", "new", "one_spokesperson", null, false],
  ["I wonder where we're headed.", "0", "question", "indirect", "untargeted", [], "mission.destination", "new", "one_spokesperson", null, false],
  ["Why are we going?", "0", "question", "wh", "untargeted", [], "mission.objective", "new", "one_spokesperson", null, false],
  ["What are we actually doing today?", "0", "question", "wh", "untargeted", [], "mission.objective", "new", "one_spokesperson", "today", false],
  ["Okay, well that's that, where do we head to next?", "Ti", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  ["What's next?", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  ["what do we do now", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", "now", false],
  ["Alright cool. Are we all going together?", "Md", "question", "yes_no", "group", ALL, "transition.participants", "new", "one_spokesperson", null, false],
  ["Is Tonya coming?", "0", "question", "yes_no", "untargeted", [], "transition.participants", "new", "one_spokesperson", null, false],
  ["Where is Tonya?", "0", "question", "wh", "untargeted", [], "person.presence", "new", "one_spokesperson", null, false],
  ["Do we split up at staging?", "0", "question", "yes_no", "group", ALL, "transition.participants", "new", "one_spokesperson", null, false],
  ["Who's coming with me?", "0", "question", "wh", "untargeted", [], "transition.participants", "new", "one_spokesperson", null, false],
  ["When do we leave?", "0", "question", "wh", "untargeted", [], "mission.schedule", "new", "one_spokesperson", null, false],
  ["what time's departure", "0", "question", "wh", "untargeted", [], "mission.schedule", "new", "one_spokesperson", null, false],
  ["How do we get to the outpost?", "0", "question", "wh", "untargeted", [], "mission.route", "new", "one_spokesperson", null, false],
  ["What did Maxwell tell us to do after the briefing?", "0", "question", "wh", "untargeted", [], "procedure.instruction_history", "new", "one_spokesperson", "earlier", false],
  // items / places
  ["Who has the camera?", "0", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["Does anyone have the camera?", "0", "question", "yes_no", "group", ALL, "item.holder", "new", "one_knower", null, false],
  ["What are the startup materials for?", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["Where are the materials going?", "0", "question", "wh", "untargeted", [], "item.destination", "new", "one_spokesperson", null, false],
  ["What's in the duffle?", "0", "question", "wh", "untargeted", [], "item.contents", "new", "one_spokesperson", null, false],
  ["What is the Threshold?", "0", "question", "wh", "untargeted", [], "place.definition", "new", "one_spokesperson", null, false],
  ["Is the Threshold on right now?", "0", "question", "yes_no", "untargeted", [], "place.status", "new", "one_spokesperson", "now", false],
  ["What does ASYNC actually do?", "0", "question", "wh", "untargeted", [], "institution.purpose", "new", "one_spokesperson", null, false],
  ["Have you been there?", "Md", "question", "yes_no", "inherited", ["Malcolm"], "person.complex_experience", "continuation", "each_self_concise", "ever", false],
  ["What is there?", "Md", "question", "wh", "inherited", ["Malcolm"], "place.definition", "continuation", "one_spokesperson", null, false],
  // meta
  ["What did you mean by \"verbal recall\"?", "Gi", "question", "wh", "inherited", ["Giselle"], "conversation.meaning_of", "continuation", "one_spokesperson", "earlier", false],
  ["How do you know?", "Md", "question", "wh", "inherited", ["Malcolm"], "conversation.explanation", "continuation", "one_spokesperson", null, false],
  ["What did Tonya say?", "Gi", "question", "wh", "untargeted", [], "conversation.reported_speech", "new", "one_spokesperson", "earlier", false],
  ["Can you repeat that?", "Gi", "request", null, "inherited", ["Giselle"], "conversation.repetition", "continuation", "one_spokesperson", null, false],
  ["Can you even go in there?", "Gcx", "question", "yes_no", "inherited", ["Giselle"], "place.access", "continuation", "one_spokesperson", null, false],
  // clarify
  ["Give him the thing.", "0", "request", null, "untargeted", [], null, "new", "one_spokesperson", null, true],
  ["you two?", "0", "elliptical_continuation", "wh", "subset", [], null, "continuation", "one_spokesperson", null, true],
  ["What about it?", "0", "elliptical_continuation", "wh", "untargeted", [], null, "continuation", "one_spokesperson", null, true],
  ["Blorp?", "0", "question", "declarative", "untargeted", [], null, "new", "one_spokesperson", null, true],
  ["Is it over there?", "0", "question", "yes_no", "untargeted", [], null, "new", "one_spokesperson", null, true],
  // equipment staging phase
  ["Who's carrying the layout record?", "S", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["are we all going in together", "S", "question", "yes_no", "group", ALL, "transition.participants", "new", "one_spokesperson", null, false],
  ["Nervous yet, Giselle?", "S", "question", "declarative", "explicit", ["Giselle"], "person.nervousness", "new", "each_self", "now", false],
  ["Where do we go from here?", "S", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", null, false],
  // answers to an NPC question
  ["The camera.", "GQ", "answer", null, "inherited", ["Giselle"], "item.holder", "answer", "one_spokesperson", null, false],
  // repairs with fillers / group repairs / exclusion by name
  ["Oops, I meant Tonya", "MfD", "repair", null, "explicit", ["Tonya"], "person.first_day_at_async", "repair", "each_self", "today", false],
  ["I was actually asking all of you", "Tf", "repair", null, "group", ALL, "person.wellbeing", "repair", "each_self", "now", false],
  ["That one was meant for everybody", "MxC", "repair", null, "group", ALL, "person.complex_experience", "repair", "each_self_concise", "ever", false],
  ["I didn't ask you, Giselle", "GdM", "repair", null, "explicit", ["Malcolm"], "item.contents", "repair", "one_spokesperson", null, false],
  ["Tonya, I meant", "MfD", "repair", null, "explicit", ["Tonya"], "person.first_day_at_async", "repair", "each_self", "today", false],
  ["that isn't really an answer", "MxC", "repair", null, "inherited", ["Malcolm"], "person.complex_experience", "repair", "each_self_concise", "ever", false],
  // attention with a pending question
  ["Earth to Malcolm", "PnM", "attention_call", null, "explicit", ["Malcolm"], "item.destination", "attention", "one_spokesperson", null, false],
  ["You there, Malcolm?", "PnM", "attention_call", null, "explicit", ["Malcolm"], "item.destination", "attention", "one_spokesperson", null, false],
  ["Can I have everyone's attention?", "0", "attention_call", null, "untargeted", [], null, "attention", "one_spokesperson", null, false],
  // round-taking / item / sequence / challenge ellipsis
  ["You next, Malcolm", "XR2", "elliptical_continuation", null, "explicit", ["Malcolm"], "person.complex_experience", "continuation", "each_self_concise", "ever", false],
  ["And the lamp?", "Hc", "elliptical_continuation", "wh", "untargeted", [], "item.holder", "continuation", "one_spokesperson", null, false],
  ["the spectrometer too?", "Hc", "elliptical_continuation", "wh", "untargeted", [], "item.holder", "continuation", "one_spokesperson", null, false],
  ["and after that?", "Tw", "elliptical_continuation", "wh", "inherited", ["Tonya"], "procedure.next_incomplete_step", "continuation", "one_spokesperson", null, false],
  ["not even a bit?", "Tn", "elliptical_continuation", "wh", "inherited", ["Tonya"], "person.nervousness", "continuation", "each_self", "now", false],
  ["I've been in the Complex before. Have you, Giselle?", "0", "elliptical_continuation", "wh", "explicit", ["Giselle"], "person.complex_experience", "continuation", "each_self_concise", "ever", false],
  // lexical coverage (items, route, schedule, presence, activity, opinion, institution, indirect wrappers)
  ["Does anybody have the lamp?", "0", "question", "yes_no", "group", ALL, "item.holder", "new", "one_knower", null, false],
  ["Whose camera is this?", "0", "question", "wh", "untargeted", [], "item.holder", "new", "one_spokesperson", null, false],
  ["What's the deal with the camera?", "0", "question", "wh", "untargeted", [], "item.purpose", "new", "one_spokesperson", null, false],
  ["Is Staging far?", "0", "question", "yes_no", "untargeted", [], "mission.route", "new", "one_spokesperson", null, false],
  ["Are we leaving soon?", "0", "question", "yes_no", "untargeted", [], "mission.schedule", "new", "one_spokesperson", null, false],
  ["Is Maxwell around?", "0", "question", "yes_no", "untargeted", [], "person.presence", "new", "one_spokesperson", null, false],
  ["What's everyone doing right now?", "0", "question", "wh", "group", ALL, "person.current_activity", "new", "each_self", "now", false],
  ["Why does ASYNC need us here?", "0", "question", "wh", "untargeted", [], "institution.purpose", "new", "one_spokesperson", null, false],
  ["I dunno where Outpost A is", "0", "question", "indirect", "untargeted", [], "place.definition", "new", "one_spokesperson", null, false],
  ["somebody tell me when we leave", "0", "question", "indirect", "group", ALL, "mission.schedule", "new", "one_knower", null, false],
  ["Now what?", "0", "question", "wh", "untargeted", [], "procedure.next_incomplete_step", "new", "one_spokesperson", "now", false],
  // sarcasm / farewell / thanks
  ["Oh great, a broken lamp.", "0", "sarcasm", null, "untargeted", [], null, "new", "one_spokesperson", null, false],
  ["Love how nobody explains anything.", "0", "sarcasm", null, "untargeted", [], null, "new", "one_spokesperson", null, false],
  ["See you all later", "0", "farewell", null, "group", ALL, null, "new", "each_ack", null, false],
  ["Thanks Tonya", "Tf", "thanks", null, "explicit", ["Tonya"], null, "new", "none", null, false]
];

const lines = ROWS.map(([utterance, ctx, speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify], i) => JSON.stringify({ id: `d${String(i + 1).padStart(3, "0")}`, context: C[ctx], utterance, expected: { speech_act, question_form, addressee_kind, addressees, predicate, discourse_relation, cardinality, temporal_scope, should_clarify } }));
fs.writeFileSync(path.join(__dirname, "dev-corpus.jsonl"), `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} dev items`);
