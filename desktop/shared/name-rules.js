(function(root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.YBNameRules = rules;
})(typeof window !== "undefined" ? window : globalThis, function() {
  "use strict";
  // Whole normalized words avoid rejecting real names such as Scunthorpe.
  const rejectedWords = new Set(["fuck", "fucker", "fucking", "motherfucker", "shit", "shithead", "bullshit", "cunt", "asshole", "bitch", "bastard"]);
  function valid(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 12 || !/^\p{L}+(?:['’-]\p{L}+)*$/u.test(name)) return false;
    const normalized = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    return !rejectedWords.has(normalized.replace(/['’-]/g, "")) && !normalized.split(/['’-]/).some(part => rejectedWords.has(part));
  }
  function invalidFields(names) {
    return ["last_name", "first_name"].filter(field => !valid(names?.[field]));
  }
  return { valid, invalidFields };
});
