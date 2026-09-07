"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "verification", "test-manifest.json");
const AUTHORITY_PATH = path.join(ROOT, "verification", "verification-authority.json");

function reconcile() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Missing manifest file at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(AUTHORITY_PATH)) {
    console.error(`Missing authority file at ${AUTHORITY_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const authority = JSON.parse(fs.readFileSync(AUTHORITY_PATH, "utf8"));

  const testFiles = manifest.test_files || [];
  const manifestByFile = new Map();
  const byTierAndStatus = {};
  const byStatus = { included: 0, quarantined: 0, retired: 0 };
  const byTier = {};

  for (const entry of testFiles) {
    manifestByFile.set(entry.file, entry);
    const tier = entry.tier || "unknown";
    const status = entry.status || "unknown";

    byStatus[status] = (byStatus[status] || 0) + 1;
    byTier[tier] = (byTier[tier] || 0) + 1;

    byTierAndStatus[tier] ??= {};
    byTierAndStatus[tier][status] = (byTierAndStatus[tier][status] || 0) + 1;
  }

  const authorityTiers = Object.keys(authority.required_tests || {});
  let discrepancies = 0;

  console.log("================================================================================");
  console.log("            YELLOW BEAST — VERIFICATION INVENTORY RECONCILIATION                ");
  console.log("================================================================================");
  console.log(`Manifest Version:  ${manifest.version}`);
  console.log(`Authority Version: ${authority.version}`);
  console.log(`Total Test Files:  ${testFiles.length}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("TIER & STATUS BREAKDOWN:");
  console.log(
    "Tier".padEnd(16) +
    "Total".padStart(8) +
    "Included".padStart(12) +
    "Quarantined".padStart(14) +
    "Retired".padStart(10) +
    "Authority Req".padStart(16)
  );
  console.log("-".repeat(76));

  let totalIncluded = 0;
  let totalQuarantined = 0;
  let totalRetired = 0;
  let totalAuthorityReq = 0;

  const allTiers = Array.from(new Set([...Object.keys(byTier), ...authorityTiers])).sort();

  for (const tier of allTiers) {
    const counts = byTierAndStatus[tier] || {};
    const inc = counts.included || 0;
    const quar = counts.quarantined || 0;
    const ret = counts.retired || 0;
    const tierTotal = (byTier[tier] || 0);
    const reqList = authority.required_tests?.[tier] || [];
    const authCount = reqList.length;

    totalIncluded += inc;
    totalQuarantined += quar;
    totalRetired += ret;
    totalAuthorityReq += authCount;

    console.log(
      tier.padEnd(16) +
      String(tierTotal).padStart(8) +
      String(inc).padStart(12) +
      String(quar).padStart(14) +
      String(ret).padStart(10) +
      String(authCount).padStart(16)
    );

    // Verify authority list match
    for (const reqFile of reqList) {
      const entry = manifestByFile.get(reqFile);
      if (!entry) {
        console.error(`[DISCREPANCY] Authority required test '${reqFile}' (tier: ${tier}) not found in manifest.`);
        discrepancies++;
      }
    }
  }

  console.log("-".repeat(76));
  console.log(
    "TOTAL".padEnd(16) +
    String(testFiles.length).padStart(8) +
    String(totalIncluded).padStart(12) +
    String(totalQuarantined).padStart(14) +
    String(totalRetired).padStart(10) +
    String(totalAuthorityReq).padStart(16)
  );
  console.log("--------------------------------------------------------------------------------");

  // Reconcile relationship: included vs aggregate
  const aggIncluded = byTierAndStatus["aggregate"]?.included || 0;
  const longWorldIncluded = byTierAndStatus["long-world"]?.included || 0;
  const nativeIncluded = byTierAndStatus["native"]?.included || 0;
  const manualIncluded = byTierAndStatus["manual"]?.included || 0;

  console.log("\nMATHEMATICAL RECONCILIATION (included vs aggregate):");
  console.log(`  1. Total manifest test files = included (${totalIncluded}) + quarantined (${totalQuarantined}) + retired (${totalRetired}) = ${testFiles.length}`);
  console.log(`  2. Included test files across tiers:`);
  console.log(`     - aggregate included:   ${aggIncluded}`);
  console.log(`     - long-world included:  ${longWorldIncluded}`);
  console.log(`     - native included:      ${nativeIncluded}`);
  console.log(`     - manual included:      ${manualIncluded}`);
  console.log(`     ---------------------------------`);
  console.log(`     Total included:         ${aggIncluded} + ${longWorldIncluded} + ${nativeIncluded} + ${manualIncluded} = ${totalIncluded}`);
  console.log(`  3. Why included (${totalIncluded}) != aggregate (${aggIncluded}):`);
  console.log(`     'included' is a cross-tier lifecycle status indicating active execution eligibility.`);
  console.log(`     'aggregate' is a single test suite execution tier containing ${aggIncluded} included test files.`);
  console.log(`     The remaining ${totalIncluded - aggIncluded} included files belong to long-world (${longWorldIncluded}) and native (${nativeIncluded}) tiers.`);

  // Verify consistency
  if (totalIncluded !== (aggIncluded + longWorldIncluded + nativeIncluded + manualIncluded)) {
    console.error("[DISCREPANCY] Sum of tier-included files does not equal total included files!");
    discrepancies++;
  }
  if (testFiles.length !== (totalIncluded + totalQuarantined + totalRetired)) {
    console.error("[DISCREPANCY] Total files does not equal sum of included, quarantined, and retired!");
    discrepancies++;
  }

  // Fast tests check
  const fastTestsInAuthority = authority.required_fast_tests?.length || 0;
  const fastTestsInManifest = testFiles.filter((t) => t.fast === true && t.status === "included").length;
  console.log(`\nFAST TIER TESTS:`);
  console.log(`  - Manifest fast included: ${fastTestsInManifest}`);
  console.log(`  - Authority required fast: ${fastTestsInAuthority}`);
  if (fastTestsInAuthority !== fastTestsInManifest) {
    console.error(`[DISCREPANCY] Manifest fast tests (${fastTestsInManifest}) does not match authority (${fastTestsInAuthority})!`);
    discrepancies++;
  }

  console.log("--------------------------------------------------------------------------------");
  if (discrepancies > 0) {
    console.error(`FAILED: ${discrepancies} discrepancies found.`);
    process.exit(1);
  } else {
    console.log("PASSED: Verification inventory is mathematically consistent and fully reconciled.");
    process.exit(0);
  }
}

if (require.main === module) {
  reconcile();
}

module.exports = { reconcile };
