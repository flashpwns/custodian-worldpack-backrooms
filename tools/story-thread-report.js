"use strict";
const history = require("./world-history"); const threads = require("./story-threads");
const world = history.createWorld({ seed: "story-thread-report" });
console.log(JSON.stringify(threads.reportSummary(threads.derive(world)), null, 2));
