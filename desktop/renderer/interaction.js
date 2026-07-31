"use strict";
// Presentation-only request coordination. This has no host APIs and never
// stores a world fact; it only decides whether an asynchronous reply still
// belongs to the currently visible renderer context.
(function (global) {
  const keyFor = (context) => `${context.worldId}:${context.mode}`;
  class RequestGate {
    constructor() { this.epoch = 0; this.sequence = 0; this.pending = null; }
    begin(context) {
      if (this.pending) return null;
      const token = Object.freeze({ id: ++this.sequence, epoch: this.epoch, context: keyFor(context) });
      this.pending = token;
      return token;
    }
    isCurrent(token, context) { return this.pending === token && token.epoch === this.epoch && token.context === keyFor(context); }
    settle(token, context) {
      if (!this.isCurrent(token, context)) return false;
      this.pending = null;
      return true;
    }
    invalidate() { this.epoch += 1; this.pending = null; }
  }
  const applicationMessage = () => "The request could not be completed. Your world was not changed.";
  const simulationMessage = () => "That attempt cannot be completed from here.";
  const api = { RequestGate, applicationMessage, simulationMessage };
  global.YBInteraction = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
