"use strict";

// ED-30 J6 minimal pairs: two utterances one small edit apart whose meanings differ. Each side lists the
// labels it must have (fields not listed are unconstrained). `context` defaults to the introductions phase.

const PAIRS = [
  // facet: tenure vs today vs ever
  [{ u: "Is this your first day?", predicate: "person.first_day_at_async" }, { u: "Is this your first expedition?", predicate: "person.expedition_experience" }],
  [{ u: "Have you been in the Complex before?", predicate: "person.complex_experience", temporal_scope: "ever" }, { u: "Have you been with ASYNC long?", predicate: "person.async_tenure" }],
  [{ u: "Where are we going?", predicate: "mission.destination" }, { u: "Where do we go next?", predicate: "procedure.next_incomplete_step" }],
  [{ u: "Who has the camera?", predicate: "item.holder" }, { u: "What is the camera for?", predicate: "item.purpose" }],
  [{ u: "What is the Threshold?", predicate: "place.definition" }, { u: "Can we go into the Threshold?", predicate: "place.access" }],
  [{ u: "Who is Maxwell?", predicate: "person.identity" }, { u: "Where is Maxwell?", predicate: "person.presence" }],
  [{ u: "How are you feeling?", predicate: "person.wellbeing" }, { u: "Are you nervous?", predicate: "person.nervousness" }],
  [{ u: "Are you excited?", predicate: "person.anticipation" }, { u: "Are you tired?", predicate: "person.fatigue" }],
  [{ u: "What did Maxwell tell us to do?", predicate: "procedure.instruction_history" }, { u: "What do we do now?", predicate: "procedure.next_incomplete_step" }],
  // addressee / cardinality
  [{ u: "Tonya, how are you?", addressee_kind: "explicit", addressees: ["Tonya"], predicate: "person.wellbeing" }, { u: "How is Tonya?", predicate: "person.wellbeing", addressees: [] }],
  [{ u: "Does anyone know where we're going?", cardinality: "one_knower", predicate: "mission.destination" }, { u: "Where are we going?", cardinality: "one_spokesperson", predicate: "mission.destination" }],
  [{ u: "Is it everyone's first day?", predicate: "person.first_day_at_async", cardinality: "each_self" }, { u: "Is it Tonya's first day?", predicate: "person.first_day_at_async", addressees: [] }],
  [{ u: "Hey Tonya", speech_act: "greeting", addressees: ["Tonya"] }, { u: "Tonya?", speech_act: "attention_call", addressees: ["Tonya"] }],
  [{ u: "Tonya, tell me about yourself.", addressees: ["Tonya"], predicate: "person.self_description" }, { u: "Tell me about Tonya.", addressees: [], predicate: "person.identity" }],
  [{ u: "Are you two coming?", addressee_kind: "subset" }, { u: "Are you all coming?", addressee_kind: "group" }],
  // temporal
  [{ u: "How are you feeling?", temporal_scope: "now" }, { u: "How were you feeling earlier?", temporal_scope: "earlier" }],
  // act
  [{ u: "Can you tell me about yourself?", speech_act: "request" }, { u: "Can you even go in there?", speech_act: "question" }],
  [{ u: "Thanks.", speech_act: "thanks" }, { u: "Thanks for what?", speech_act: "question" }],
  [{ u: "I'm Jack.", speech_act: "self_introduction" }, { u: "I'm nervous.", speech_act: "statement" }]
];

module.exports = { PAIRS };
