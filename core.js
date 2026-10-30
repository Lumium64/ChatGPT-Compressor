/* Shared by the content script, popup, and DOM tests. No page globals are used. */
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({ enabled: true, keepRecent: 3 });
  const ROLE_ATTRIBUTES = ["data-message-author-role", "data-conversation-role", "data-turn"];
  const SEARCH_ATTRIBUTES = ["data-content-search-unit-key", "data-chatgpt-search-unit-key"];
  const ROLE_SELECTOR = [
    ...ROLE_ATTRIBUTES.flatMap(attr => ["user", "assistant"].map(role => `[${attr}="${role}"]`)),
    ...SEARCH_ATTRIBUTES.flatMap(attr => ["user", "assistant"].map(role => `[${attr}$=":${role}"]`)),
    '[data-user-message-bubble="true"]', '[data-chatgpt-agent-turn-start]'
  ].join(", ");
  const ROOT_SELECTOR = 'article, [data-testid^="conversation-turn-"], [data-test-id^="conversation-turn-"], [data-turn-key]';
  const CANDIDATE_SELECTOR = `${ROOT_SELECTOR}, ${ROLE_SELECTOR}`;
  const SCOPE_SELECTOR = '[data-thread-find-target="conversation"], #thread, main, [role="main"]';
  const DISCOVERY_SELECTOR = `${CANDIDATE_SELECTOR}, ${SCOPE_SELECTOR}`;
  const VISIBILITY_ATTRIBUTES = ["hidden", "aria-hidden", "inert", "style", "class"];
  const OBSERVED_ATTRIBUTES = [...ROLE_ATTRIBUTES, ...SEARCH_ATTRIBUTES, "data-turn-key", "data-turn-id",
    "data-message-id", "data-testid", "data-test-id", "data-user-message-bubble",
    "data-chatgpt-agent-turn-start", "data-thread-find-target", "role", ...VISIBILITY_ATTRIBUTES];
  const EXCLUDED_SELECTOR = '.sr-only, nav, aside, [role="navigation"], [role="dialog"], [hidden], [aria-hidden="true"], [inert], form, textarea, [contenteditable]:not([contenteditable="false"])';
  // Response cards may contain forms; only text editors interrupt grouping.
  const EDITOR_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"])';

  function findScope(document) {
    // Prefer an explicit conversation region. A main tag is not present in every UI.
    const available = new Map();
    function isAvailable(node) {
      if (!node) return true;
      if (available.has(node)) return available.get(node);
      const style = document.defaultView.getComputedStyle(node);
      const result = !node.matches(EXCLUDED_SELECTOR) && style.display !== "none" &&
        style.visibility !== "hidden" && style.visibility !== "collapse" && isAvailable(node.parentElement);
      available.set(node, result);
      return result;
    }
    const regions = [...document.querySelectorAll('[data-thread-find-target="conversation"], #thread'),
      ...document.querySelectorAll('main, [role="main"]')].filter(isAvailable);
    return regions.find(node => [...node.querySelectorAll(ROLE_SELECTOR)].some(marker => !marker.closest(EXCLUDED_SELECTOR))) ||
      regions[0] || document.body;
  }

  function roleOf(node) {
    for (const attr of ROLE_ATTRIBUTES) {
      const value = node.getAttribute(attr);
      if (value === "user" || value === "assistant") return value;
    }
    for (const attr of SEARCH_ATTRIBUTES) {
      const value = node.getAttribute(attr) || "";
      if (value.endsWith(":user")) return "user";
      if (value.endsWith(":assistant")) return "assistant";
    }
    if (node.getAttribute("data-user-message-bubble") === "true") return "user";
    if (node.hasAttribute("data-chatgpt-agent-turn-start")) return "assistant";
    return null;
  }

  function hasAncestorIn(node, nodes) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (nodes.has(parent)) return true;
    }
    return false;
  }

  function describe(root) {
    const markers = [...root.querySelectorAll(ROLE_SELECTOR)].filter(node => !node.closest(EXCLUDED_SELECTOR));
    if (roleOf(root)) markers.unshift(root);
    const userNodes = new Set(markers.filter(node => roleOf(node) === "user"));
    return {
      users: [...userNodes].filter(node => !hasAncestorIn(node, userNodes)),
      assistants: markers.filter(node => roleOf(node) === "assistant")
    };
  }

  function normalizeSettings(value = {}) {
    if (!value || typeof value !== "object") value = {};
    const count = Number(value.keepRecent);
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
      keepRecent: Number.isInteger(count) && count >= 1 && count <= 50 ? count : DEFAULTS.keepRecent
    };
  }

  function collectTurns(scope) {
    if (!scope) return [];
    const turns = [];
    const seen = new Set();
    let current = null;

    for (const root of scope.querySelectorAll(CANDIDATE_SELECTOR)) {
      if (hasAncestorIn(root, seen) || root.closest(EXCLUDED_SELECTOR)) continue;
      if (root.querySelector(EDITOR_SELECTOR)) {
        current = null;
        continue;
      }
      const { users, assistants } = describe(root);
      // The new renderer can put a question AND its answers in one data-turn-key.
      const grouped = root.hasAttribute("data-turn-key") && users.length === 1;
      if (users.length > 1 || (!grouped && users.length && assistants.length)) {
        current = null;
        continue; // Try the individual message nodes; never hide a shared ancestor.
      }
      const role = users.length ? "user" : assistants.length ? "assistant" : null;
      if (!role) continue;
      seen.add(root);

      if (role === "user") {
        const message = users[0];
        current = {
          user: message,
          root,
          nodes: [root],
          // Keep controls inside complete groups so the site's row measurement
          // includes their height. Never hide text directly owned by a wrapper.
          inlineControl: grouped && assistants.length > 0 && message !== root &&
            ![...root.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()),
          hasReply: grouped && assistants.length > 0,
          // Stable across React replacing an article; fallback is the element itself.
          key: root.getAttribute("data-turn-key") || root.getAttribute("data-turn-id") ||
            message.dataset.messageId || SEARCH_ATTRIBUTES.map(attr => message.getAttribute(attr)).find(Boolean) || root.id || root
        };
        turns.push(current);
      } else if (current) {
        current.nodes.push(root);
        current.hasReply = true;
      }
    }
    return turns;
  }

  function diagnostics(document, scope) {
    // Counts only: never include text, URLs, turn IDs, HTML, or account data.
    const count = selector => document.querySelectorAll(selector).length;
    return {
      scope: scope?.matches('[data-thread-find-target="conversation"]') ? "conversation" :
        scope?.id === "thread" ? "thread" : scope?.tagName?.toLowerCase() || "none",
      legacyRoles: count("[data-message-author-role]"),
      turnRoles: count('[data-turn="user"], [data-turn="assistant"]'),
      turnGroups: count("[data-turn-key]"),
      contentSearchUnits: count("[data-content-search-unit-key]"),
      chatgptSearchUnits: count("[data-chatgpt-search-unit-key]"),
      conversationRoles: count("[data-conversation-role]"),
      userBubbles: count('[data-user-message-bubble="true"]')
    };
  }

  function canCollapse(turn, index, turns) {
    // The last turn may be streaming, being regenerated, or waiting for a reply.
    return turn.hasReply && index < turns.length - 1;
  }

  function shouldCollapse(turn, index, turns, settings, overrides) {
    if (!settings.enabled || !canCollapse(turn, index, turns)) return false;
    if (overrides.has(turn.key)) return overrides.get(turn.key);
    return index < turns.length - settings.keepRecent;
  }

  function preview(message) {
    // Search-unit wrappers also contain speaker labels (「あなたの発言:」「You」).
    // Prefer the actual prompt bubble; don't strip words from the user's text.
    const bubbleSelector = '[data-user-message-bubble="true"], .user-message-bubble-color';
    const content = message.matches(bubbleSelector) ? message :
      message.querySelector(bubbleSelector) || message.querySelector('.whitespace-pre-wrap') || message;
    // Bounded traversal avoids serializing huge pasted prompts on every discovery.
    const walker = message.ownerDocument.createTreeWalker(content, 4, {
      acceptNode(node) {
        return node.parentElement?.closest('.sr-only, [aria-hidden="true"], [hidden], button, svg') ? 2 : 1;
      }
    });
    let text = "";
    let node;
    while (text.length < 140 && (node = walker.nextNode())) {
      text += node.textContent.slice(0, 140 - text.length) + " ";
    }
    text = text.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 90) + (text.length > 90 ? "…" : "") : "";
  }

  globalThis.ChatGPTCompressor = Object.freeze({ DEFAULTS, ROLE_SELECTOR, SCOPE_SELECTOR, DISCOVERY_SELECTOR,
    OBSERVED_ATTRIBUTES, VISIBILITY_ATTRIBUTES, normalizeSettings,
    findScope, collectTurns, diagnostics, canCollapse, shouldCollapse, preview });
})();
