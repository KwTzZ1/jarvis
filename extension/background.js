// Extension Jarvis : dans les onglets de Jarvis uniquement, les sites affichés dans un cadre
// ne peuvent plus refuser l'affichage (on retire X-Frame-Options et Content-Security-Policy de ces cadres).
// Les autres onglets du navigateur ne sont pas concernés.

const RULE_BASE = 1000;

function ruleFor(tabId) {
  return {
    id: RULE_BASE + tabId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        { header: "x-frame-options", operation: "remove" },
        { header: "content-security-policy", operation: "remove" },
        { header: "content-security-policy-report-only", operation: "remove" },
      ],
    },
    // Seulement les cadres (pas la page Jarvis elle-même), et seulement dans cet onglet.
    condition: { tabIds: [tabId], resourceTypes: ["sub_frame"] },
  };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg?.type !== "jarvis-hello" || typeof tabId !== "number" || tabId < 0) return;
  // Vérifie que le message vient bien d'une page Jarvis (adresse locale).
  let host = "";
  try {
    host = new URL(sender.url).hostname;
  } catch {}
  if (host !== "127.0.0.1" && host !== "localhost") return;
  chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [RULE_BASE + tabId], addRules: [ruleFor(tabId)] })
    .then(() => reply({ ok: true }))
    .catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_BASE + tabId] }).catch(() => {});
});
