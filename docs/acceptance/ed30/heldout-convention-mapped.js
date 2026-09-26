// Convention-mapped scoring (reported alongside the raw numbers, never instead of them):
//   C1 an unaddressed line to the room: labeller "group", pipeline "untargeted" (same behaviour: one voice)
//   C2 "each_self_concise" is a refinement of "each_self"
//   P1 (policy, ED-29 fairness rotation) labeller "inherited:<active speaker>" for untargeted follow-ups; the
//      pipeline rotates to the fair knower -- counted separately, not mapped.
const E = require("../../../tools/dialogue-eval");
const items = E.readCorpus(`${__dirname}/heldout-corpus.spent.jsonl`);
const sc = E.scene();
const n = items.length;
let sa = 0, ad = 0, adP1 = 0, pr = 0, rel = 0, card = 0, temp = 0, qf = 0, clar = 0, cw = 0, p1 = 0;
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
for (const it of items) {
  const g = E.labelsFor(it, sc), e = it.expected;
  const c1 = e.addressee_kind === "group" && g.addressee_kind === "untargeted" && ["one_spokesperson", "one_knower"].includes(g.cardinality) && !["each_self", "each_ack"].includes(e.cardinality);
  const addrOk = (g.addressee_kind === e.addressee_kind && same(g.addressees, e.addressees ?? [])) || c1;
  const isP1 = !addrOk && e.addressee_kind === "inherited" && g.addressee_kind === "untargeted";
  if (isP1) p1++;
  if (addrOk) ad++;
  if (addrOk || isP1) adP1++;
  if (g.speech_act === e.speech_act) sa++;
  if ((g.predicate ?? null) === (e.predicate ?? null)) pr++;
  if (g.discourse_relation === e.discourse_relation) rel++;
  if ((g.cardinality === "each_self_concise" ? "each_self" : g.cardinality) === e.cardinality) card++;
  if ((g.temporal_scope ?? null) === (e.temporal_scope ?? null)) temp++;
  if ((g.question_form ?? null) === (e.question_form ?? null)) qf++;
  if (g.should_clarify) clar++;
  if (!g.should_clarify && (e.should_clarify || !(addrOk || isP1) || (g.predicate ?? null) !== (e.predicate ?? null))) cw++;
}
const pct = (x) => Math.round((x / n) * 1000) / 10;
console.log(JSON.stringify({ n, convention_mapped: { speech_act: pct(sa), addressee: pct(ad), addressee_incl_P1: pct(adP1), predicate: pct(pr), discourse_relation: pct(rel), cardinality: pct(card), temporal_scope: pct(temp), question_form: pct(qf), clarify_rate: pct(clar), confident_wrong_incl_P1: pct(cw) }, P1_policy_items: p1 }, null, 1));
