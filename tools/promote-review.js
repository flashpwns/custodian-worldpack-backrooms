"use strict";
const { data, states, stable } = require("./intake-lib");
const [claimId, reviewState] = process.argv.slice(2);
const claim = data().claimById.get(claimId);
if (!claim || !states.includes(reviewState)) throw new Error("INVALID_REVIEW_PROMOTION");
if (claim.review_state === "rejected" && reviewState === "admitted") throw new Error("REJECTED_CLAIM_REQUIRES_NEW_REVIEW_RECORD");
process.stdout.write(stable({ ok: true, operation: "review-state-proposal", claim_id: claimId, from: claim.review_state, to: reviewState, requires_human_review: true }));
