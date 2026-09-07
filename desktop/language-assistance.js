"use strict";

// Application feedback, never character speech or an in-world radio failure.
// Only classified transport metadata is admitted; raw provider errors may
// contain request content or credentials and must never reach the renderer.
const REASONS = Object.freeze({
  AUTH_INVALID: "The selected provider rejected its saved access key.",
  AUTH_MISSING: "No usable access key is configured for the selected provider.",
  BILLING_EXHAUSTED: "The selected provider has no available API credit or quota.",
  RATE_LIMITED: "The selected provider is rate limited. Wait before retrying.",
  TIMEOUT: "The selected provider did not respond in time.",
  NETWORK_UNAVAILABLE: "The selected provider could not be reached.",
  MODEL_UNAVAILABLE: "The configured model is unavailable.",
  STRUCTURED_OUTPUT_UNSUPPORTED: "The configured model rejected the required response format.",
  MALFORMED_RESPONSE: "The selected provider returned an unreadable response.",
  PROVIDER_SERVER_ERROR: "The selected provider reported a server failure."
});

function failureReason(executions) {
  const failures = executions.flatMap(item => item.attempts ?? []).filter(item => item.failure_class);
  const failure = failures.find(item => item.failure_class !== "AUTH_MISSING") ?? failures[0];
  return REASONS[failure?.failure_class] ?? "The selected language service is unavailable.";
}

function summarizeLanguageAssistance(selected, living) {
  const executions = selected.getExecutions?.() ?? [];
  const interpretation = executions.find(item => item.request_kind === "living-interpretation");
  const presentation = executions.find(item => item.request_kind === "living-presentation");
  const failed = living.status === "interpretation_failed";
  const fallback = living.status === "resolved" && (presentation?.selected_provider === "offline" || !living.validation?.accepted);
  const offline = interpretation?.selected_provider === "offline";
  let message = null;
  if (failed) message = `${failureReason(executions)} Your instruction was not executed; no world state changed. Check Settings, retry, or explicitly select Offline deterministic.`;
  else if (fallback && !offline) message = "Your action was saved. Generated presentation is unavailable or was rejected; the factual result is shown.";
  else if (offline) message = "Offline deterministic interpretation; no live AI was used for this turn.";
  return {
    interpretation_provider: interpretation?.selected_provider ?? selected.name ?? "unknown",
    presentation_provider: presentation?.selected_provider ?? null,
    hosted_interpretation: Boolean(interpretation?.attempts?.some(item => item.status === "completed" && item.hosted_request)),
    interpretation_failed: failed,
    presentation_fallback: fallback,
    message
  };
}

module.exports = { summarizeLanguageAssistance, failureReason };
