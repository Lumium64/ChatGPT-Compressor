(() => {
  "use strict";
  const enabled = document.querySelector("#enabled");
  const keepRecent = document.querySelector("#keepRecent");
  const status = document.querySelector("#status");
  const diagnostics = document.querySelector("#diagnostics");
  const diagnosticOutput = document.querySelector("#diagnostic-output");
  const buttons = [...document.querySelectorAll("[data-action]")];
  let tabId;
  let connected = false;

  function updateButtons() {
    for (const button of buttons) button.disabled = !connected || !enabled.checked;
  }

  async function command(action = "status", settings) {
    try {
      if (tabId === undefined) throw new Error("No active tab");
      const response = await chrome.tabs.sendMessage(tabId, { type: "ctf:command", action, settings });
      if (!response) throw new Error("No content script");
      connected = true;
      diagnostics.hidden = response.total !== 0 || !response.diagnostics;
      diagnosticOutput.textContent = diagnostics.hidden ? "" : JSON.stringify({
        version: chrome.runtime?.getManifest?.().version, ...response.diagnostics
      }, null, 2);
      status.textContent = !response.settings.enabled ? "折りたたみはオフです。" : response.total === 0
        ? "会話を認識できませんでした。会話が表示されている場合は再読み込みし、改善しなければ下の検出情報を確認してください。"
        : `${response.total} ターン中 ${response.collapsed} ターンを折りたたみ中`;
    } catch {
      connected = false;
      diagnostics.hidden = true;
      status.textContent = "ChatGPTのタブで使用できます。導入直後はページを再読み込みしてください。";
    }
    updateButtons();
  }

  async function save() {
    if (!keepRecent.checkValidity()) {
      keepRecent.reportValidity();
      return;
    }
    const settings = ChatGPTCompressor.normalizeSettings({ enabled: enabled.checked, keepRecent: keepRecent.valueAsNumber });
    try {
      await chrome.storage.local.set({ turnFoldSettings: settings });
      // Apply explicitly as the storage event may reach the content script later.
      await command("configure", settings);
    } catch {
      status.textContent = "設定を保存できませんでした。もう一度お試しください。";
    }
  }

  enabled.addEventListener("change", save);
  keepRecent.addEventListener("change", save);
  for (const button of buttons) button.addEventListener("click", () => command(button.dataset.action));
  updateButtons();

  Promise.all([
    chrome.storage.local.get("turnFoldSettings"),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]).then(([stored, tabs]) => {
    const settings = ChatGPTCompressor.normalizeSettings(stored.turnFoldSettings);
    enabled.checked = settings.enabled;
    keepRecent.value = settings.keepRecent;
    tabId = tabs[0]?.id;
    return command();
  }).catch(() => { status.textContent = "設定を読み込めませんでした。拡張機能を開き直してください。"; });
})();
