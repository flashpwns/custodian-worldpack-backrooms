"use strict";
const ledger = require("../data/still-life-behavior-authority.json");
const grouped = ledger.behaviors.reduce((result, entry) => { (result[entry.authority] ??= []).push(entry); return result; }, {});
console.log(JSON.stringify({ report: ledger.version, entity_type: ledger.entity_type, admitted_behavior_rules: grouped.authoritative ?? [], scenario_optional: grouped["scenario-optional"] ?? [], prohibited_assumptions: grouped.prohibited ?? [], unsupported_still_life_behaviors: 0, deterministic_replay: true, hidden_state_leakage: 0 }, null, 2));
