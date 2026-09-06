"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");

const VERSION = "yellow-beast-communication-routing@v1";

function parseArgs(firstArg, secondArg) {
  if (firstArg && (firstArg.expedition || firstArg.spatial || firstArg.session)) {
    return {
      run: firstArg,
      channel: secondArg?.channel ?? secondArg?.type ?? "LOCAL",
      sender: secondArg?.sender,
      recipients: secondArg?.recipients ?? [],
      text: secondArg?.text,
      purpose: secondArg?.purpose ?? "local-conversation"
    };
  }
  return {
    run: firstArg?.run,
    channel: firstArg?.channel ?? firstArg?.type ?? "LOCAL",
    sender: firstArg?.sender,
    recipients: firstArg?.recipients ?? [],
    text: firstArg?.text,
    purpose: firstArg?.purpose ?? "local-conversation"
  };
}

function determineListeners(firstArg, secondArg) {
  const { run, channel = "LOCAL", sender, recipients = [] } = parseArgs(firstArg, secondArg);
  const normSender = canonicalLedger.normalizePersonnelId(run, sender) ?? sender;
  const channelType = String(channel).toUpperCase();
  const listeners = [];

  const candidateRecipients = (recipients && recipients.length > 0)
    ? recipients
    : (run?.expedition?.team?.members ?? []).map((m) => m.personnel_id ?? m.id);

  if (channelType === "LOCAL" || channelType === "LOCAL_SPEECH") {
    for (const rec of candidateRecipients) {
      const normRec = canonicalLedger.normalizePersonnelId(run, rec) ?? rec;
      if (normRec === normSender) continue;

      const sameLoc = perceptionService.sameRoom(normSender, normRec, run);
      if (sameLoc) {
        listeners.push({ id: normRec, heard: true });
      } else {
        listeners.push({ id: normRec, heard: false, reason: "out_of_range" });
      }
    }
  } else if (channelType === "FIELD_RADIO" || channelType === "STANDARD" || channelType === "RADIO") {
    if (!candidateRecipients.includes("Standard")) {
      candidateRecipients.push("Standard");
    }
    // Radio check: does sender hold or have radio access?
    const senderItems = canonicalLedger.getEquipmentHeldBy(run, normSender);
    const senderHasRadio = senderItems.some((i) => i.id === "survey-radio" || i.capability === "field-radio")
      || run?.expedition?.radio?.authorized === true;

    for (const rec of candidateRecipients) {
      const normRec = canonicalLedger.normalizePersonnelId(run, rec) ?? rec;
      if (normRec === normSender) continue;

      if (!senderHasRadio) {
        listeners.push({ id: normRec, heard: false, reason: "sender_lacks_radio" });
        continue;
      }

      if (normRec === "Standard" || normRec === "standard") {
        const authorized = run?.expedition?.radio?.authorized !== false;
        listeners.push({
          id: "Standard",
          heard: authorized,
          ...(authorized ? {} : { reason: "radio_check_incomplete" })
        });
        continue;
      }

      const recItems = canonicalLedger.getEquipmentHeldBy(run, normRec);
      const recHasRadio = recItems.some((i) => i.id === "survey-radio" || i.capability === "field-radio");
      if (recHasRadio) {
        listeners.push({ id: normRec, heard: true });
      } else {
        listeners.push({ id: normRec, heard: false, reason: "recipient_lacks_radio" });
      }
    }
  }

  return {
    channel: channelType,
    sender: normSender,
    listeners
  };
}

function routeAndDeliver(firstArg, secondArg) {
  const { run, channel = "LOCAL", sender, recipients = [], text, purpose = "local-conversation" } = parseArgs(firstArg, secondArg);
  const normSender = canonicalLedger.normalizePersonnelId(run, sender) ?? sender;
  const routing = determineListeners({ run, channel, sender: normSender, recipients });
  const interval = run?.expedition?.clock?.interval ?? 0;

  const actualRecipients = routing.listeners.filter((l) => l.heard).map((l) => l.id);

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const messageRecord = {
    id: messageId,
    sender: normSender,
    intended_recipients: routing.listeners.map((l) => l.id),
    actual_recipients: actualRecipients,
    channel: routing.channel,
    text: String(text ?? ""),
    purpose,
    sent_at: interval,
    delivered_at: actualRecipients.length > 0 ? interval : null,
    state: actualRecipients.length > 0 ? "delivered" : "failed"
  };

  if (run) {
    run.expedition ??= {};
    run.expedition.messages ??= [];
    run.expedition.messages.push(messageRecord);

    canonicalLedger.recordRadioTransmission(run, {
      channel: routing.channel,
      sender: normSender,
      recipients: messageRecord.intended_recipients,
      listeners: routing.listeners,
      text: messageRecord.text,
      interval
    });

    // Update knowledge of listeners who heard
    for (const listenerId of actualRecipients) {
      if (listenerId === "Standard") continue;
      const member = canonicalLedger.getObserverMember(run, listenerId);
      if (member) {
        member.known_information ??= [];
        member.known_information.push(canonicalLedger.createReportedKnowledge({
          proposition: text,
          source_observer_id: normSender,
          source_message_id: messageId,
          interval
        }));
      }
    }
  }

  return {
    delivered: actualRecipients.length > 0,
    recipients: actualRecipients,
    routing,
    message: messageRecord
  };
}

module.exports = {
  VERSION,
  determineListeners,
  routeAndDeliver
};
