"use strict";
// Reproduce the frozen experiment from the last verified production source, without
// resetting the working checkout or importing private captures/labels. This source
// commit already reproduced the original 944-row/552-render manifest. Current live
// production has a separate engineering replay and is not the frozen population.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const FROZEN_SOURCE_COMMIT = "f873e4966cc04332fe4368b5fe12a7230a29f32c";
async function captureFrozenCorpus() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-reader-frozen-source-"));
  try {
    const archive = path.join(root, "source.tar");
    execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, FROZEN_SOURCE_COMMIT], {cwd:path.join(__dirname,"../..")});
    execFileSync("tar", ["-xf", archive, "-C", root]);
    fs.unlinkSync(archive);
    return await require(path.join(root,"tools/dialogue-reader-replay")).captureCorpus();
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
}
module.exports = { FROZEN_SOURCE_COMMIT, captureFrozenCorpus };
