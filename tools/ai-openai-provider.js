"use strict";

const {
  createHostedProvider,
  classifyProviderError,
  FAILURE_CLASSES,
  PROVIDER_SPECS,
  INTENT_SCHEMA,
  LIVING_INTERPRETATION_SCHEMA,
  LIVING_PRESENTATION_SCHEMA,
  LOCAL_DIALOGUE_SCHEMA
} = require("./ai-hosted-transport");

function createOpenAIProvider(options = {}) {
  return createHostedProvider({ providerId: "openai", ...options });
}

module.exports = {
  createOpenAIProvider,
  createHostedProvider,
  classifyProviderError,
  FAILURE_CLASSES,
  PROVIDER_SPECS,
  INTENT_SCHEMA,
  LIVING_INTERPRETATION_SCHEMA,
  LIVING_PRESENTATION_SCHEMA,
  LOCAL_DIALOGUE_SCHEMA
};
