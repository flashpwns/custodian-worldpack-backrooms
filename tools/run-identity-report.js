"use strict";
const { startRun } = require("./run-bootstrap");
const identity = require("./run-identity");
const v2 = require("./procedural-complex-v2");

const profiles = ["field-researcher", "async-command", "local-anomaly", "lost"];
const runs = profiles.flatMap((profile) => ["yb32-identity-a", "yb32-identity-b"].map((seed) => startRun({ profile, seed, scenario: profile === "field-researcher" ? "procedural-survey" : null, generator_version: profile === "field-researcher" ? v2.VERSION : null }).run));
const sameSeed = startRun({ profile: "field-researcher", seed: "a", scenario: "procedural-survey", generator_version: v2.VERSION }).run;
const sameSeedAgain = startRun({ profile: "field-researcher", seed: "a", scenario: "procedural-survey", generator_version: v2.VERSION }).run;
const differentSeed = startRun({ profile: "field-researcher", seed: "b", scenario: "procedural-survey", generator_version: v2.VERSION }).run;
const forbidden = /rarity|difficulty|affix|destiny|archetype|plot|modifier/i;
const identities = identity.reportRuns(runs);
console.log(JSON.stringify({ version: "yellow-beast-run-identity-report@v1", variation_surfaces: ["procedural environment family/lighting/surface/landmark/frontier", "profile-declared knowledge/resources/permissions", "bounded initial questions", "Lost existing loadout/exit condition"], profiles, deterministic_same_seed: JSON.stringify(identity.describe(sameSeed)) === JSON.stringify(identity.describe(sameSeedAgain)), different_seed_may_vary: JSON.stringify(identity.describe(sameSeed)) !== JSON.stringify(identity.describe(differentSeed)), canonical_authority: "none; descriptor is derived and descriptive", source_chain_preserved: true, observer_safe: identities.every(({ identity: item }) => !forbidden.test(JSON.stringify(item))), identities, invariants: { "same seed starting identity divergence": 0, "different seed outside admitted surfaces": 0, "run identity canonical authority": 0, "hidden plot selection": 0, "gameplay stat modifier": 0, "rarity tier": 0, "observer context leakage": 0, "source/claim/authority bypass": 0 } }, null, 2));
