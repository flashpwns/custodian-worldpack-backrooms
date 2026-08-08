"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SOURCE = path.resolve(__dirname, "..", "SIMULATION_DOCTRINE.md");
const SECTION_MARKERS = [
  "0.2 RUNTIME INTERPRETATION CONTRACT",
  "2.1 Reality Changes Through Causes",
  "2.31 Causal UI",
  "3.17 Observer-Safe Projection",
  "4.32 Provider Context Must Be Knowledge-Bounded",
  "6.37 Personnel Output Pipeline",
  "7.3 LOCAL",
  "7.5 Natural Language Does Not Bypass Authority",
  "7.9 STANDARD"
];

function read() {
  const content = fs.readFileSync(SOURCE, "utf8");
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const lines = content.split(/\r?\n/);
  const sections = {};
  for (const marker of SECTION_MARKERS) {
    const start = lines.findIndex((line) => line.includes(marker));
    if (start < 0) continue;
    const end = lines.findIndex((line, index) => index > start && /^##? /.test(line));
    sections[marker] = lines.slice(start, end < 0 ? start + 80 : end).join("\n").slice(0, 12000);
  }
  return { source: "SIMULATION_DOCTRINE.md", source_path: SOURCE, sha256: hash, priority: "constitutional", sections };
}

function context() {
  const value = read();
  return { ...value, section_ids: Object.keys(value.sections), bounded: true };
}

module.exports = { SOURCE, read, context };
