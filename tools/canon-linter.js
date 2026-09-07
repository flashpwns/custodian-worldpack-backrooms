"use strict";

const canonLexicon = require("./canon-lexicon");

const VERSION = "yellow-beast-canon-linter@v1";

function lintCanonText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { valid: true, violations: [], cleanedText: String(text ?? "") };
  }

  const violations = [];
  let cleanedText = text;

  for (const item of canonLexicon.FORBIDDEN_TERMINOLOGY) {
    const flags = item.pattern.flags.includes("g") ? item.pattern.flags : `${item.pattern.flags}g`;
    const regex = new RegExp(item.pattern.source, flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      violations.push({
        term: match[0],
        replacement: item.replacement,
        reason: item.reason,
        index: match.index
      });
    }
    cleanedText = cleanedText.replace(new RegExp(item.pattern.source, flags), item.replacement);
  }

  return {
    valid: violations.length === 0,
    violations,
    cleanedText
  };
}

function enforceCanonText(text) {
  return lintCanonText(text).cleanedText;
}

function validatePresentationCanon(presentation) {
  if (!presentation) return { valid: true, violations: [] };
  const allViolations = [];
  const fields = ["scene_description", "speech", "narration", "text", "summary", "public_reason"];
  for (const field of fields) {
    if (presentation[field]) {
      const lint = lintCanonText(presentation[field]);
      if (!lint.valid) {
        for (const v of lint.violations) {
          allViolations.push({ field, ...v });
        }
      }
    }
  }
  return {
    valid: allViolations.length === 0,
    violations: allViolations
  };
}

module.exports = {
  VERSION,
  lintCanonText,
  enforceCanonText,
  validatePresentationCanon
};
