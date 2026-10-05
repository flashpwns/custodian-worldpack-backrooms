#!/usr/bin/env node
"use strict";

// Reader Phase 2 Step 0.1 -- generates the FROZEN FUZZY GUARD (tools/data/reader-fuzzy-guard.json). Developer tooling.
//
// Stage 3 of the reader lexicon (dialogue-reader-lexicon.js) fuzzy-binds a mistyped token to an observer-visible
// single-token name. A correctly spelled ordinary English word is not a typo: "complete" is not "Complex", "touch" is
// not "torch", "lamb" is not "lamp". The guard lists every dictionary word that stage 3 WOULD otherwise fuzzy-bind
// (directly, or through a regular -s / -es inflection) to a single-token name of this worldpack's lexicon; the
// lexicon then leaves those tokens unbound. Authored exact labels and aliases are never affected.
//
// Source: the public-domain web2 word list (Webster's Second International, 1934) as shipped at /usr/share/dict/words
// on BSD / macOS; lower-case entries only (proper names are not ordinary words). The source digest and the lexicon
// forms the list was computed against are recorded, so the file is reproducible and its staleness checkable.
//
//   node tools/dialogue-reader-fuzzy-guard.js [--dict /usr/share/dict/words] [--out tools/data/reader-fuzzy-guard.json] [--check]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const LX = require("./dialogue-reader-lexicon");

const GUARD_VERSION = "yellow-beast-reader-fuzzy-guard@v1";
const DEFAULT_DICT = "/usr/share/dict/words";

/** The lexicon the guard is computed against: the development scene's observer-visible lexicon (every scenario of this
 * worldpack shares its canonical entity index). */
function referenceLexicon() {
  const E = require("./dialogue-eval");
  return LX.observerLexicon(E.scene().entities);
}

function computeGuard(dictText, lexicon) {
  const single = LX.singleForms(lexicon);
  const names = new Set(single.map((f) => f.tokens[0]));
  const words = [...new Set(String(dictText).split(/\r?\n/).map((w) => w.trim()).filter((w) => /^[a-z]+$/.test(w)))];
  const out = new Set();
  for (const w of words) {
    if (names.has(w)) continue; // an exact single-token name binds before stage 3
    for (const form of [w, `${w}s`, `${w}es`]) {
      if (!LX.fuzzyEligible(form) || names.has(form)) continue;
      if (LX.fuzzyHits(form, single).length) { out.add(w); break; }
    }
  }
  return { words: [...out].sort(), forms: [...names].sort() };
}

function main() {
  const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
  const dict = arg("--dict", DEFAULT_DICT);
  const out = arg("--out", LX.FUZZY_GUARD_FILE);
  const text = fs.readFileSync(dict, "utf8");
  const { words, forms } = computeGuard(text, referenceLexicon());
  const doc = {
    version: GUARD_VERSION,
    source: { file: path.basename(dict), sha256: crypto.createHash("sha256").update(text).digest("hex"), license: "public domain (web2, Webster's Second International, 1934)" },
    rule: "lower-case dictionary words w such that w, w+s or w+es would fuzzy-bind (Damerau <= 1 at length 4-6, <= 2 at >= 7, same first letter) to a single-token observer-visible name",
    lexicon_forms: forms,
    words
  };
  const json = `${JSON.stringify(doc, null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const same = fs.existsSync(out) && fs.readFileSync(out, "utf8") === json;
    console.log(same ? "fuzzy guard up to date" : "fuzzy guard STALE: regenerate");
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  console.log(`${words.length} guarded words over ${forms.length} single-token forms -> ${out}`);
}
if (require.main === module) main();

module.exports = { GUARD_VERSION, DEFAULT_DICT, computeGuard, referenceLexicon };
