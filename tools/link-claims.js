"use strict";
const { data, relations, stable } = require("./intake-lib");
const [claimId, relation, targetId] = process.argv.slice(2);
const { claimById } = data();
if (!claimById.has(claimId) || !claimById.has(targetId) || !relations.includes(relation)) throw new Error("INVALID_CLAIM_RELATIONSHIP");
process.stdout.write(stable({ ok: true, operation: "claim-link-proposal", claim_id: claimId, relationship: { relation, claim_id: targetId } }));
