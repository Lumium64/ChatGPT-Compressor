const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { source } = require("./helpers.cjs");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function popup({ available = true, storageFails = false, total = 5, diagnostics } = {}) {
  const dom = new JSDOM(source("popup.html"), { runScripts: "outside-only" });
  const { window } = dom;
  let settings = { enabled: true, keepRecent: 3 };
  const commands = [];
  window.chrome = {
    runtime: { getManifest: () => ({ version: "0.1.7" }) },
    storage: { local: {
      async get() { return { turnFoldSettings: settings }; },
      async set(value) {
        if (storageFails) throw new Error("storage error");
        settings = value.turnFoldSettings;
      }
    } },
    tabs: {
      async query() { return [{ id: 42 }]; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 42);
        if (!available) throw new Error("not a ChatGPT tab");
        commands.push(message);
        return { total, collapsed: message.action === "expand" ? 0 : 2, settings, diagnostics };
      }
    }
  };
  window.eval(source("core.js"));
  window.eval(source("popup.js"));
  await tick();
  return { window, document: window.document, commands, getSettings: () => settings, close: () => window.close() };
}

test("popup loads settings and sends bulk actions to the active tab", async t => {
  const env = await popup();
  t.after(env.close);
  assert.equal(env.document.querySelector("#enabled").checked, true);
  assert.match(env.document.querySelector("#status").textContent, /5 ターン中 2/);
  env.document.querySelector('[data-action="expand"]').click();
  await tick();
  assert.equal(env.commands.at(-1).action, "expand");
  assert.match(env.document.querySelector("#status").textContent, /5 ターン中 0/);
});

test("unsupported layouts show versioned structural diagnostics instead of telling the user to open a chat", async t => {
  const env = await popup({ total: 0, diagnostics: { scope: "main", legacyRoles: 0, turnGroups: 4 } });
  t.after(env.close);
  assert.equal(env.document.querySelector("#diagnostics").hidden, false);
  assert.match(env.document.querySelector("#diagnostic-output").textContent, /0.1.7/);
  assert.match(env.document.querySelector("#status").textContent, /会話を認識できません/);
});

test("settings are saved and explicitly applied; invalid counts are not saved", async t => {
  const env = await popup();
  t.after(env.close);
  const count = env.document.querySelector("#keepRecent");
  count.value = "7";
  count.dispatchEvent(new env.window.Event("change"));
  await tick();
  assert.equal(env.getSettings().keepRecent, 7);
  assert.equal(env.commands.at(-1).action, "configure");
  count.value = "0";
  count.dispatchEvent(new env.window.Event("change"));
  await tick();
  assert.equal(env.getSettings().keepRecent, 7);
  const enabled = env.document.querySelector("#enabled");
  count.value = "7";
  enabled.checked = false;
  enabled.dispatchEvent(new env.window.Event("change"));
  await tick();
  assert.equal(env.getSettings().enabled, false);
  assert.equal(env.document.querySelector('[data-action="collapse"]').disabled, true);
});

test("non-ChatGPT tabs show installation guidance and disable actions", async t => {
  const env = await popup({ available: false });
  t.after(env.close);
  assert.match(env.document.querySelector("#status").textContent, /再読み込み/);
  assert.equal(env.document.querySelector('[data-action="expand"]').disabled, true);
});

test("storage write failure is visible to the user", async t => {
  const env = await popup({ storageFails: true });
  t.after(env.close);
  env.document.querySelector("#enabled").dispatchEvent(new env.window.Event("change"));
  await tick();
  assert.match(env.document.querySelector("#status").textContent, /保存できません/);
});
