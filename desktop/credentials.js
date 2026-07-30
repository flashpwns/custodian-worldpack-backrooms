"use strict";
// Secrets never enter settings JSON. Electron's OS-backed safeStorage encrypts
// the small encrypted credential blob; unsupported platforms keep secrets only
// for the current host lifetime rather than falling back to plaintext.
const fs = require("node:fs"); const path = require("node:path");
class CredentialStore {
  constructor({ safeStorage = null, file = null } = {}) { this.safeStorage = safeStorage; this.file = file; this.memory = new Map(); }
  available() { return Boolean(this.safeStorage?.isEncryptionAvailable?.()); }
  set(name, secret) { if (!name || typeof secret !== "string" || !secret.trim()) return { ok: false, code: "CREDENTIAL_INVALID" }; if (!this.available()) { this.memory.set(name, secret); return { ok: true, persistent: false }; } const encrypted = this.safeStorage.encryptString(secret); fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, encrypted); return { ok: true, persistent: true }; }
  get(name) { if (this.memory.has(name)) return this.memory.get(name); if (!this.available() || !this.file || !fs.existsSync(this.file)) return null; try { return this.safeStorage.decryptString(fs.readFileSync(this.file)); } catch { return null; } }
  configured(name) { return Boolean(this.get(name)); }
  remove(name) { this.memory.delete(name); if (this.file && fs.existsSync(this.file)) fs.unlinkSync(this.file); return { ok: true }; }
}
module.exports = { CredentialStore };
