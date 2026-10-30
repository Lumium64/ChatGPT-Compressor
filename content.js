(() => {
  "use strict";
  const core = globalThis.ChatGPTCompressor;
  let settings = { ...core.DEFAULTS };
  let turns = [];
  const routeKey = () => location.pathname + location.search;
  let route = routeKey();
  let activeScope = null;
  let scheduled = null;
  let disposed = false;
  let suspended = false;
  let routeWatcher = null;
  const navigationRetries = new Set();
  const overrides = new Map();
  const bars = new Map();
  const hidden = new Set();

  const observer = new MutationObserver(records => {
    if (checkRoute() || records.some(isStructuralChange)) schedule();
  });

  function observe() {
    // The body itself can be replaced during a client-side transition.
    if (!disposed && !suspended) observer.observe(document.documentElement, { childList: true, subtree: true,
      attributes: true, attributeFilter: core.OBSERVED_ATTRIBUTES });
  }

  function isStructuralChange(record) {
    if (record.type === "attributes") {
      if (!core.VISIBILITY_ATTRIBUTES.includes(record.attributeName)) return true;
      const node = record.target;
      // Ignore token styling and animations inside answers. Watch conversation
      // panels and their ancestors, including cached panels that are still hidden.
      return node === activeScope || (activeScope && node.contains(activeScope)) ||
        node.matches(core.SCOPE_SELECTOR) || !!node.querySelector(core.SCOPE_SELECTOR);
    }
    // Text/token updates don't require discovering every turn again.
    return [...record.addedNodes, ...record.removedNodes].some(node => {
      if (node.nodeType !== 1) return false;
      // React may remove an injected bar while leaving the message in place.
      if (node.matches(".ctf-turn-bar")) return true;
      if (node.closest(".ctf-turn-bar")) return false;
      return node.matches(core.DISCOVERY_SELECTOR) || !!node.querySelector(core.DISCOVERY_SELECTOR);
    });
  }

  function schedule() {
    if (scheduled !== null || disposed || suspended) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      refresh();
    }, 120);
  }

  function clearNavigationRetries() {
    for (const timer of navigationRetries) clearTimeout(timer);
    navigationRetries.clear();
  }

  function retryAfterNavigation() {
    clearNavigationRetries();
    // A navigation event can precede React committing/revealing the new panel.
    // These retries are bounded; late message arrivals are handled by the observer.
    for (const delay of [300, 1000, 2500]) {
      const timer = setTimeout(() => {
        navigationRetries.delete(timer);
        schedule();
      }, delay);
      navigationRetries.add(timer);
    }
  }

  function checkRoute() {
    if (disposed || suspended || route === routeKey()) return false;
    route = routeKey();
    overrides.clear();
    retryAfterNavigation();
    return true;
  }

  function onNavigation() {
    checkRoute();
    schedule();
  }

  function startRouteWatcher() {
    clearInterval(routeWatcher);
    // Fallback for History API changes not delivered to this isolated world.
    // Only compare the URL string here: never scan a stable page periodically.
    routeWatcher = setInterval(() => {
      if (!document.hidden && checkRoute()) schedule();
    }, 750);
  }

  function restore() {
    for (const node of hidden) node.removeAttribute("data-ctf-collapsed");
    hidden.clear();
    for (const entry of bars.values()) entry.bar.remove();
    bars.clear();
  }

  function refresh() {
    if (disposed || suspended) return;
    checkRoute();
    // Discard our own mutations, otherwise rendering controls would cause a loop.
    observer.disconnect();
    try {
      const scope = core.findScope(document);
      if (activeScope && activeScope !== scope) overrides.clear();
      activeScope = scope;
      turns = core.collectTurns(scope);
      const keys = new Set(turns.map(turn => turn.key));
      for (const key of overrides.keys()) if (!keys.has(key)) overrides.delete(key);
      render();
    } catch (error) {
      // A changed site layout must never leave a conversation inaccessible.
      restore();
      console.warn("ChatGPT Compressor: 会話の表示を復元しました。", error);
    } finally {
      observe();
    }
  }

  function createBar(key) {
    const bar = document.createElement("div");
    bar.className = "ctf-turn-bar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ctf-turn-button";
    const number = document.createElement("span");
    number.className = "ctf-turn-number";
    const preview = document.createElement("span");
    preview.className = "ctf-turn-preview";
    const action = document.createElement("span");
    action.className = "ctf-turn-action";
    button.append(number, preview, action);
    bar.append(button);
    const entry = { bar, button, number, preview, action, collapsed: false };
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const top = button.getBoundingClientRect().top;
      overrides.set(key, !entry.collapsed);
      refresh();
      // Keep the clicked control in place when restoring a long answer.
      if (button.isConnected) {
        const delta = button.getBoundingClientRect().top - top;
        if (Math.abs(delta) > 1) scrollContainer(button).scrollBy({ top: delta, behavior: "instant" });
      }
    });
    return entry;
  }

  function scrollContainer(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
    }
    return window;
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function render() {
    if (!settings.enabled) {
      restore();
      return;
    }
    const activeKeys = new Set();
    const nextHidden = new Set();
    let displayNumber = 0;
    turns.forEach((turn, index) => {
      // Only add an actionable bar with a real prompt preview. Otherwise leave
      // the conversation visible, so content never depends on a missing control.
      if (!core.canCollapse(turn, index, turns)) return;
      const preview = core.preview(turn.user);
      if (!preview) return;
      activeKeys.add(turn.key);
      let entry = bars.get(turn.key);
      if (!entry) {
        entry = createBar(turn.key);
        bars.set(turn.key, entry);
      }
      if (entry.bar.nextElementSibling !== turn.root) turn.root.before(entry.bar);
      entry.collapsed = core.shouldCollapse(turn, index, turns, settings, overrides);
      entry.button.setAttribute("aria-expanded", String(!entry.collapsed));
      setText(entry.number, `${entry.collapsed ? "▸" : "▾"} ${++displayNumber}`);
      setText(entry.preview, preview);
      setText(entry.action, entry.collapsed ? "展開" : "折りたたむ");
      entry.button.title = preview;
      if (entry.collapsed) {
        for (const node of turn.nodes) {
          // Don't move focus into an invisible subtree when automatically collapsing.
          if (node.contains(document.activeElement)) entry.button.focus({ preventScroll: true });
          nextHidden.add(node);
          node.setAttribute("data-ctf-collapsed", "true");
        }
      }
    });
    for (const node of hidden) if (!nextHidden.has(node)) node.removeAttribute("data-ctf-collapsed");
    hidden.clear();
    for (const node of nextHidden) hidden.add(node);
    for (const [key, entry] of bars) {
      if (!activeKeys.has(key)) {
        entry.bar.remove();
        bars.delete(key);
      }
    }
  }

  function status() {
    return { total: turns.length, collapsed: [...bars.values()].filter(entry => entry.collapsed).length,
      settings, diagnostics: turns.length ? undefined : core.diagnostics(document, core.findScope(document)) };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "ctf:command") return;
    if (message.action === "configure") {
      settings = core.normalizeSettings(message.settings);
      overrides.clear();
    }
    refresh();
    if (["expand", "collapse", "auto"].includes(message.action)) {
      overrides.clear();
      if (message.action !== "auto") {
        for (const turn of turns) overrides.set(turn.key, message.action === "collapse");
      }
      refresh();
    }
    respond(status());
  });

  function onSettingsChanged(changes, area) {
    if (area !== "local" || !changes.turnFoldSettings) return;
    settings = core.normalizeSettings(changes.turnFoldSettings.newValue);
    overrides.clear();
    refresh();
  }

  chrome.storage.onChanged.addListener(onSettingsChanged);
  window.addEventListener("popstate", onNavigation);
  // Navigation API also covers pushState navigation without patching page scripts.
  window.navigation?.addEventListener("currententrychange", onNavigation);
  window.navigation?.addEventListener("navigatesuccess", onNavigation);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onNavigation();
  });
  startRouteWatcher();
  chrome.storage.local.get("turnFoldSettings").then(result => {
    settings = core.normalizeSettings(result.turnFoldSettings);
    refresh();
  }).catch(() => refresh());

  window.addEventListener("pagehide", event => {
    suspended = event.persisted;
    disposed = !event.persisted;
    observer.disconnect();
    clearTimeout(scheduled);
    scheduled = null;
    clearInterval(routeWatcher);
    clearNavigationRetries();
    if (disposed) restore();
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted || disposed) return;
    suspended = false;
    startRouteWatcher();
    observe();
    onNavigation();
  });
})();
