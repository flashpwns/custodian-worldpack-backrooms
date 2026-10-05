"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const sha=x=>crypto.createHash("sha256").update(typeof x==="string"?x:JSON.stringify(x)).digest("hex");
const EDITION_SHA256="8e0b162ea486916c1c530eda6aec7b0dedd12af906ee39527cbca874316cc72e";
function loadEdition(){const text=fs.readFileSync(path.join(__dirname,"../../docs/acceptance/dialogue-natural-conversation/full-engineering-edition.json"),"utf8");assert.equal(sha(text),EDITION_SHA256,"reviewed engineering edition pin");return JSON.parse(text);}
function applyFields(row,change){assert.equal(sha(row),change.historical_turn_sha256??change.historical_row_sha256,"exact historical amendment source");assert.equal(row.text,change.text);assert.deepEqual(Object.keys(change.expected_fields),change.fields);assert.ok(change.reason.length>40);Object.assign(row,change.expected_fields);}
function currentCharacterization(reference){const doc=loadEdition(),out=structuredClone(reference);for(const c of doc.characterization_changes){const session=out.sessions.find(s=>s.id===c.scenario);assert.ok(session,c.scenario);applyFields(session.turns[c.provider][c.turn],c);}out.digest=sha(out.sessions).slice(0,16);return out;}
function currentRows(reference,kind){const doc=loadEdition(),rows=structuredClone(reference);for(const c of doc[`${kind}_changes`])applyFields(rows[c.row],c);return rows;}
module.exports={loadEdition,currentCharacterization,currentRows};
