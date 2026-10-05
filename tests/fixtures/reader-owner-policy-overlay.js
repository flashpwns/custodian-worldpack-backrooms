"use strict";
// Historical artifacts remain hash-pinned. Jack's 2026-10-05 Convention B decision
// changes only this validator disposition; all routing, wording and lifecycle evidence stays exact.
const assert = require('node:assert/strict');
function currentRoundtrip(row) {
  if (row.fixture !== 'scenario/chip-target' || row.text !== 'Tonya, how are you?') return row;
  assert.deepEqual(row.verdict, {ok:false, disposition:'reject_fields',errors:['V2:contradicts_chip_target']});
  return {...row,verdict:{ok:true,disposition:'accept',errors:[]}};
}
function currentShadow(row) {
  if (row.fixture !== 'scenario/chip-target' || row.text !== 'Tonya, how are you?') return row;
  assert.equal(row.target,'Malcolm');
  assert.equal(row.disposition,'REJECT_FIELDS');
  assert.deepEqual(row.conflicts,['chip_vs_vocative']);
  return {...row,disposition:'ACCEPT'};
}
module.exports={currentRoundtrip,currentShadow};
