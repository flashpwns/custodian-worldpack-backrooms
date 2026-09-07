"use strict";
// Secrets never enter settings JSON. Electron's OS-backed safeStorage encrypts
// the small encrypted credential blob; unsupported platforms keep secrets only
// for the current host lifetime rather than falling back to plaintext.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class CredentialStore {
  constructor({ safeStorage = null, file = null, directory = null } = {}) {
    this.safeStorage = safeStorage;
    this.file = file;
    this.directory = directory || (file ? path.dirname(file) : null);
    this.memory = new Map();
    this.persisted = new Set();
  }

  available() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  filePathFor(name) {
    if (!name) return null;
    if (name === "openai" && this.file) return this.file;
    if (this.directory) return path.join(this.directory, `${name}.bin`);
    if (this.file) return path.join(path.dirname(this.file), `${name}.bin`);
    return null;
  }

  set(name, secret) {
    if (!name || typeof secret !== "string" || !secret.trim()) {
      return { ok: false, code: "CREDENTIAL_INVALID" };
    }
    this.memory.set(name, secret.trim());
    this.persisted.delete(name);
    if (!this.available()) {
      return { ok: true, persistent: false };
    }
    const targetFile = this.filePathFor(name);
    if (!targetFile) {
      return { ok: true, persistent: false };
    }
    const temporary = `${targetFile}.${crypto.randomUUID()}.tmp`;
    try {
      const encrypted = this.safeStorage.encryptString(secret.trim());
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(temporary, encrypted, { mode:0o600 });
      fs.renameSync(temporary, targetFile);
      this.persisted.add(name);
      return { ok: true, persistent: true };
    } catch {
      return { ok: true, persistent: false };
    } finally {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    }
  }

  get(name) {
    if (this.memory.has(name)) return this.memory.get(name);
    const targetFile = this.filePathFor(name);
    if (this.available() && targetFile && fs.existsSync(targetFile)) {
      try {
        const decrypted = this.safeStorage.decryptString(fs.readFileSync(targetFile));
        if (decrypted) {
          this.memory.set(name, decrypted);
          this.persisted.add(name);
          return decrypted;
        }
      } catch {}
    }
    const envKey = `${String(name).toUpperCase()}_API_KEY`;
    if (process.env[envKey] && typeof process.env[envKey] === "string" && process.env[envKey].trim()) {
      return process.env[envKey].trim();
    }
    return null;
  }

  configured(name) {
    return Boolean(this.get(name));
  }

  describe(name) {
    const configured = this.configured(name);
    const file = this.filePathFor(name);
    const saved = Boolean(file && fs.existsSync(file));
    const environment = Boolean(process.env[`${String(name).toUpperCase()}_API_KEY`]?.trim());
    return { configured, saved, persistent:saved && this.persisted.has(name), environment, session_only:this.memory.has(name) && !this.persisted.has(name) };
  }

  remove(name) {
    const targetFile = this.filePathFor(name);
    if (targetFile && fs.existsSync(targetFile)) {
      try { fs.unlinkSync(targetFile); }
      catch { return { ok:false, code:"CREDENTIAL_REMOVE_FAILED" }; }
    }
    this.memory.delete(name);
    this.persisted.delete(name);
    return { ok: true };
  }
}

module.exports = { CredentialStore };
