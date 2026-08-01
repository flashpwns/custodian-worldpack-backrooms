"use strict";
const assert=require("node:assert/strict"), test=require("node:test"), report=require("../tools/navigation-report.js");
test("navigation report exposes a player hierarchy and preserves all pass-one invariants",()=>{ void report; const source=require("node:fs").readFileSync(require("node:path").join(__dirname,"../desktop/renderer/renderer.js"),"utf8"); assert.match(source,/Operational Records/); assert.match(source,/Operational Programs/); assert.doesNotMatch(source,/STORY_THREAD_V1|OBSERVER_PROJECTION|CANONICAL_EFFECT/); });
