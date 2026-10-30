// Loads the real unpacked extension in Chromium against a local, synthetic response.
// No login or external requests; this does not assert the current live ChatGPT DOM.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { chromium } = require("playwright");
const { conversation, article, modernConversation, modernTurn, conversationWithAnswerForm } = require("./helpers.cjs");

(async () => {
  const extension = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-compressor-chromium-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const scenarios = [
      { name: "answer-form", html: `<main>${conversationWithAnswerForm()}</main>`, scope: "main", messages: "[data-turn-key]", perTurn: 1,
        next: modernTurn(5) },
      { name: "legacy", html: `<main>${conversation()}</main>`, scope: "main", messages: "article", perTurn: 2,
        next: article("user", "u5") + article("assistant", "a5") },
      { name: "modern-grouped", html: `<main></main><div data-thread-find-target="conversation">${modernConversation()}</div>`,
        scope: '[data-thread-find-target="conversation"]', messages: "[data-turn-key]", perTurn: 1, next: modernTurn(5) },
      { name: "modern-search", html: `<div role="main">${modernConversation(5, "data-chatgpt-search-unit-key", false)}</div>`,
        scope: '[role="main"]', messages: "[data-chatgpt-search-unit-key]", perTurn: 2,
        next: modernTurn(5, "data-chatgpt-search-unit-key", false) }
    ];
    for (const scenario of scenarios) {
      await context.route(`https://chatgpt.com/c/${scenario.name}`, route => route.fulfill({
        contentType: "text/html", body: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ChatGPT Compressor test</title><style>body {font:16px system-ui; margin:30px} article,[data-turn-key] {padding:20px;border-bottom:1px solid #ddd} main,[role=main],[data-thread-find-target] {max-width:800px;margin:auto}</style></head><body>${scenario.html}<textarea aria-label="Message"></textarea></body></html>`
      }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`https://chatgpt.com/c/${scenario.name}`);
      await page.waitForSelector(".ctf-turn-button");
      assert.equal(await page.locator(".ctf-turn-button").count(), 4);
      assert.equal(await page.locator(`${scenario.messages}:visible`).count(), 3 * scenario.perTurn);
      if (scenario.name === "answer-form") {
        assert.equal(await page.locator('[data-turn-key="sample-0"]').isVisible(), false);
      }
      await page.locator(".ctf-turn-button").first().click();
      if (scenario.name === "answer-form") {
        await page.locator('input[type="radio"]').check();
        assert.equal(await page.locator('input[type="radio"]').isChecked(), true);
        await page.locator('form button').click();
      }
      assert.equal(await page.locator(`${scenario.messages}:visible`).count(), 4 * scenario.perTurn);
      await page.evaluate(({ scope, next }) => document.querySelector(scope).insertAdjacentHTML("beforeend", next), scenario);
      await page.waitForFunction(() => document.querySelectorAll(".ctf-turn-button").length === 5);
      assert.equal(await page.locator(".ctf-turn-button:disabled").count(), 0);
      await page.locator(".ctf-turn-button").first().focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(`${scenario.messages}:visible`).count(), 3 * scenario.perTurn);
      await fs.mkdir(path.join(extension, "test-results"), { recursive: true });
      const filename = scenario.name === "legacy" ? "conversation.png" : `conversation-${scenario.name}.png`;
      await page.screenshot({ path: path.join(extension, "test-results", filename), fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${scenario.name}: unpacked extension, visibility, expansion, new turns, keyboard`);
    }

    await context.route("https://chatgpt.com/c/spa-a", route => route.fulfill({
      contentType: "text/html", body: `<!doctype html><html><head><style>.cached-panel{display:none}</style></head><body>
      <nav><button id="switch-b">Chat B</button><button id="switch-c">Chat C</button></nav>
      <div id="panel-a"><div data-thread-find-target="conversation">${modernConversation(5)}</div></div>
      <div id="panel-b" class="cached-panel"><div data-thread-find-target="conversation">${modernConversation(7)}</div></div>
      <div id="panel-c" hidden><div data-thread-find-target="conversation"></div></div>
      </body></html>`
    }));
    const spa = await context.newPage();
    await spa.goto("https://chatgpt.com/c/spa-a");
    await spa.waitForFunction(() => document.querySelectorAll("#panel-a .ctf-turn-bar").length === 4);
    await spa.evaluate(delayedHtml => {
      window.testDocumentIdentity = "same-document";
      function reveal(id) {
        for (const panel of document.querySelectorAll("body > div")) {
          panel.hidden = panel.id !== id;
          panel.classList.remove("cached-panel");
        }
      }
      document.querySelector("#switch-b").addEventListener("click", () => {
        history.pushState({}, "", "/c/spa-b");
        setTimeout(() => reveal("panel-b"), 450);
      });
      document.querySelector("#switch-c").addEventListener("click", () => {
        history.pushState({}, "", "/c/spa-c");
        reveal("panel-c");
        setTimeout(() => {
          document.querySelector("#panel-c > div").innerHTML = delayedHtml;
        }, 900);
      });
      addEventListener("popstate", () => reveal(location.pathname.endsWith("spa-a") ? "panel-a" : "panel-b"));
    }, modernConversation(8));
    await spa.click("#switch-b");
    await spa.waitForFunction(() => document.querySelectorAll('#panel-b [data-ctf-collapsed="true"]').length === 4);
    assert.equal(await spa.locator("#panel-a .ctf-turn-bar, #panel-a [data-ctf-collapsed]").count(), 0);
    await spa.goBack();
    await spa.waitForFunction(() => document.querySelectorAll('#panel-a [data-ctf-collapsed="true"]').length === 2);
    await spa.goForward();
    await spa.waitForFunction(() => document.querySelectorAll('#panel-b [data-ctf-collapsed="true"]').length === 4);
    await spa.click("#switch-c");
    await spa.waitForFunction(() => document.querySelectorAll('#panel-c [data-ctf-collapsed="true"]').length === 5);
    assert.equal(await spa.locator("#panel-c .ctf-turn-button").count(), 7);
    assert.equal(await spa.locator('#panel-c [data-turn-key="turn-7"]').evaluate(node => node.previousElementSibling?.matches(".ctf-turn-bar") || false), false);
    assert.equal(await spa.evaluate(() => window.testDocumentIdentity), "same-document");
    await spa.close();
    console.log("PASS SPA: cached panel switch, delayed messages, back/forward, no reload or popup interaction");
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
