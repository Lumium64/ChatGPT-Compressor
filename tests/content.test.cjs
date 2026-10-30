const test = require("node:test");
const assert = require("node:assert/strict");
const { environment, article, modernTurn, modernConversation, conversationWithAnswerForm } = require("./helpers.cjs");

function folded(env) { return env.document.querySelectorAll('[data-ctf-collapsed="true"]'); }
function buttons(env) { return env.document.querySelectorAll(".ctf-turn-button"); }
function assertNoBar(root) {
  assert.equal(root.previousElementSibling?.matches(".ctf-turn-bar") || false, false);
  assert.equal(root.querySelector(".ctf-turn-bar"), null);
  assert.equal(root.hasAttribute("data-ctf-container"), false);
  assert.equal(root.hasAttribute("data-ctf-collapsed"), false);
}

test("initial load hides complete user/assistant pairs and clicking restores the original nodes", async t => {
  const env = await environment();
  t.after(env.close);
  const original = env.document.querySelector("article");
  assert.equal(buttons(env).length, 4);
  assert.equal(folded(env).length, 4);
  assert.equal(env.window.getComputedStyle(original).display, "none");
  buttons(env)[0].click();
  assert.equal(folded(env).length, 2);
  assert.equal(env.document.querySelector("article"), original);
  assert.equal(buttons(env)[0].getAttribute("aria-expanded"), "true");
});

test("bulk actions protect the last turn; auto restores the configured policy", async t => {
  const env = await environment();
  t.after(env.close);
  assert.equal(env.command("collapse").collapsed, 4);
  assertNoBar(env.document.querySelector('[data-message-id="u4"]').closest("article"));
  assert.equal(env.command("expand").collapsed, 0);
  assert.equal(env.command("auto").collapsed, 2);
});

test("new messages update automatically and a manually expanded turn remains expanded", async t => {
  const env = await environment();
  t.after(env.close);
  buttons(env)[0].click();
  env.document.querySelector("main").insertAdjacentHTML("beforeend", article("user", "u5"));
  await env.settle();
  assert.equal(buttons(env).length, 5);
  assert.equal(folded(env).length, 4);
  assert.equal(buttons(env)[0].getAttribute("aria-expanded"), "true");
  env.document.querySelector("main").insertAdjacentHTML("beforeend", article("assistant", "a5"));
  await env.settle();
  assert.equal(env.command().total, 6);
  assert.equal(env.document.querySelector('[data-message-id="a5"]').closest("article").hasAttribute("data-ctf-collapsed"), false);
});

test("streaming text and paragraphs do not trigger full document discovery", async t => {
  const env = await environment();
  t.after(env.close);
  const originalQuery = env.document.querySelectorAll.bind(env.document);
  let scans = 0;
  env.document.querySelectorAll = selector => {
    scans++;
    return originalQuery(selector);
  };
  const reply = env.document.querySelector('[data-message-id="a4"]');
  for (let i = 0; i < 30; i++) {
    reply.firstChild.textContent += " token";
    reply.insertAdjacentHTML("beforeend", "<p>streaming</p>");
  }
  await env.settle();
  assert.equal(scans, 0);
  assert.equal(folded(env).length, 4);
});

test("replaced articles retain manual state without retaining detached hidden nodes", async t => {
  const env = await environment();
  t.after(env.close);
  env.command("collapse");
  const old = env.document.querySelector("article");
  old.outerHTML = article("user", "u0", "edited prompt");
  await env.settle();
  assert.equal(old.hasAttribute("data-ctf-collapsed"), false);
  assert.equal(env.document.querySelector("article").getAttribute("data-ctf-collapsed"), "true");
  assert.match(buttons(env)[0].textContent, /edited prompt/);
  assert.equal(buttons(env).length, 4);
});

test("navigation clears overrides even when React reuses the same DOM", async t => {
  const env = await environment();
  t.after(env.close);
  env.command("expand");
  env.window.history.pushState({}, "", "/c/other");
  env.document.querySelector("main").append(env.document.createElement("div"));
  await env.settle();
  // Do not ask the popup for status: that itself refreshes and can mask this bug.
  assert.equal(folded(env).length, 4);
});

test("pushState without DOM mutations reapplies automatic folding without opening the popup", async t => {
  const env = await environment();
  t.after(env.close);
  env.command("expand");
  env.window.history.pushState({}, "", "/c/url-only");
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(folded(env).length, 4);
});

for (const visibility of ["hidden", "aria-hidden", "inert", "style", "class"]) {
  test(`switching cached conversation panels via ${visibility} selects and folds the new panel`, async t => {
    const attrs = { hidden: "hidden", "aria-hidden": 'aria-hidden="true"', inert: "inert",
      style: 'style="display:none"', class: 'class="cached-panel"' };
    const env = await environment({ html: `<style>.cached-panel { display: none }</style>
      <div id="panel-a"><div data-thread-find-target="conversation">${modernConversation(5)}</div></div>
      <div id="panel-b" ${attrs[visibility]}><div data-thread-find-target="conversation">${modernConversation(6)}</div></div>` });
    t.after(env.close);
    const first = env.document.querySelector("#panel-a");
    const next = env.document.querySelector("#panel-b");
    // Navigation can finish before the cached panel is revealed.
    env.window.history.pushState({}, "", "/c/cached");
    env.document.querySelector("main").append(env.document.createElement("div"));
    await env.settle();
    first.setAttribute(visibility, next.getAttribute(visibility));
    next.removeAttribute(visibility);
    await env.settle();
    assert.equal(next.querySelectorAll(".ctf-turn-bar").length, 5);
    assert.equal(next.querySelectorAll('[data-ctf-collapsed="true"]').length, 3);
    assert.equal(first.querySelectorAll(".ctf-turn-bar, [data-ctf-collapsed]").length, 0);
  });
}

test("observes a replaced body and its delayed conversation without a reload", async t => {
  const env = await environment();
  t.after(env.close);
  const nextBody = env.document.createElement("body");
  env.document.body.replaceWith(nextBody);
  await env.settle();
  nextBody.innerHTML = `<main>${modernConversation(6)}</main>`;
  await env.settle();
  assert.equal(buttons(env).length, 5);
  assert.equal(folded(env).length, 3);
});

test("stable pages and streamed style changes do not trigger periodic conversation scans", async t => {
  const env = await environment();
  t.after(env.close);
  const reply = env.document.querySelector('[data-message-id="a4"] p');
  const originalQuery = env.document.querySelectorAll.bind(env.document);
  let scans = 0;
  env.document.querySelectorAll = selector => {
    scans++;
    return originalQuery(selector);
  };
  for (let i = 0; i < 30; i++) {
    reply.className = `stream-${i}`;
    reply.style.opacity = String(i / 30);
  }
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(scans, 0);
});

test("back-forward cache restoration resumes automatic folding more than once", async t => {
  const env = await environment({ html: modernConversation(5) });
  t.after(env.close);
  for (let count = 6; count <= 7; count++) {
    env.window.dispatchEvent(new env.window.PageTransitionEvent("pagehide", { persisted: true }));
    env.document.querySelector("main").innerHTML = modernConversation(count);
    env.window.history.replaceState({}, "", `/c/restored-${count}`);
    env.window.dispatchEvent(new env.window.PageTransitionEvent("pageshow", { persisted: true }));
    await env.settle();
    assert.equal(buttons(env).length, count - 1);
    assert.equal(folded(env).length, count - 3);
  }
});

test("turn removal and regeneration unhide the newly latest turn", async t => {
  const env = await environment();
  t.after(env.close);
  env.command("collapse");
  const articles = [...env.document.querySelectorAll("article")];
  articles.slice(4).forEach(node => node.remove());
  await env.settle();
  assert.equal(buttons(env).length, 1);
  assert.equal(folded(env).length, 2);
  assert.equal(articles[2].hasAttribute("data-ctf-collapsed"), false);
  assert.equal(articles[4].hasAttribute("data-ctf-collapsed"), false);
});

test("turning the extension off restores every article and removes controls", async t => {
  const env = await environment();
  t.after(env.close);
  await env.setSettings({ enabled: false, keepRecent: 1 });
  assert.equal(folded(env).length, 0);
  assert.equal(buttons(env).length, 0);
  assert.equal(env.document.querySelectorAll("article").length, 10);
  await env.setSettings({ enabled: true, keepRecent: 1 });
  assert.equal(folded(env).length, 8);
});

test("keyboard focus is moved to the control before a subtree is hidden", async t => {
  const env = await environment({ settings: { enabled: true, keepRecent: 50 } });
  t.after(env.close);
  const link = env.document.createElement("a");
  link.href = "#example";
  env.document.querySelector("article").append(link);
  link.focus();
  env.command("collapse");
  assert.equal(env.document.activeElement, buttons(env)[0]);
});

test("unknown page structure leaves all content visible", async t => {
  const env = await environment({ html: '<div class="unknown-message">unknown layout</div>' });
  t.after(env.close);
  assert.equal(folded(env).length, 0);
  assert.equal(buttons(env).length, 0);
  assert.equal(env.command().total, 0);
});

test("new layout folds whole exchanges and discovers new turns without legacy attributes", async t => {
  const env = await environment({ html: modernConversation() });
  t.after(env.close);
  assert.equal(env.command().total, 5);
  assert.equal(folded(env).length, 2);
  assert.equal(folded(env)[0].getAttribute("data-turn-key"), "turn-0");
  buttons(env)[0].click();
  assert.equal(folded(env).length, 1);
  env.document.querySelector("main").insertAdjacentHTML("beforeend", modernTurn(5));
  await env.settle();
  assert.equal(buttons(env).length, 5);
  assert.equal(folded(env).length, 2);
  assertNoBar(env.document.querySelector('[data-turn-key="turn-5"]'));
  assert.equal(env.command("expand").collapsed, 0);
});

test("discovers search markers set after the empty turn group was inserted", async t => {
  const env = await environment({ html: '<div data-turn-key="hydrating"><div id="question">質問</div><div id="answer">回答</div></div>' + modernTurn(1) });
  t.after(env.close);
  assert.equal(buttons(env).length, 0);
  env.document.querySelector("#question").setAttribute("data-chatgpt-search-unit-key", "h:0:user");
  env.document.querySelector("#answer").setAttribute("data-chatgpt-search-unit-key", "h:1:assistant");
  await env.settle();
  assert.equal(buttons(env).length, 1);
  assert.equal(env.command().total, 2);
});

test("failed detection reports only structural counts, with no conversation text or IDs", async t => {
  const env = await environment({ html: '<div data-turn-key="private-id">secret question</div>' });
  t.after(env.close);
  const status = env.command();
  assert.equal(status.total, 0);
  assert.equal(status.diagnostics.turnGroups, 1);
  assert.doesNotMatch(JSON.stringify(status), /private-id|secret question/);
});

test("an externally removed fold control is restored while its messages remain hidden", async t => {
  const env = await environment();
  t.after(env.close);
  env.document.querySelector(".ctf-turn-bar").remove();
  await env.settle();
  assert.equal(buttons(env).length, 4);
  buttons(env)[0].click();
  assert.equal(folded(env).length, 2);
});

test("empty previews remain visible without placeholder controls, including after bulk collapse", async t => {
  const attachment = '<div data-turn-key="attachment"><div data-content-search-unit-key="a:0:user"><h5 class="sr-only">あなたの発言:</h5><div>You</div><div data-user-message-bubble="true"><img alt="添付画像"></div></div><div data-content-search-unit-key="a:1:assistant">画像の説明</div></div>';
  const env = await environment({ html: attachment + modernConversation(5) });
  t.after(env.close);
  const root = env.document.querySelector('[data-turn-key="attachment"]');
  assertNoBar(root);
  assert.equal(buttons(env).length, 4);
  assert.doesNotMatch(env.document.body.textContent, /画像・ファイルなどのメッセージ|表示を維持/);
  env.command("collapse");
  assertNoBar(root);
  assert.equal(env.window.getComputedStyle(root).display, "block");
  assertNoBar(env.document.querySelector('[data-turn-key="turn-4"]'));
});

test("a lone latest turn has no bar; it gains a control only after the next question", async t => {
  const env = await environment({ html: modernTurn(0) });
  t.after(env.close);
  assert.equal(buttons(env).length, 0);
  const first = env.document.querySelector('[data-turn-key="turn-0"]');
  assertNoBar(first);
  env.document.querySelector("main").insertAdjacentHTML("beforeend", '<div data-turn-key="pending"><div data-user-message-bubble="true">次の質問</div></div>');
  await env.settle();
  assert.equal(buttons(env).length, 1);
  assert.equal(first.firstElementChild.matches(".ctf-turn-bar"), true);
  assertNoBar(env.document.querySelector('[data-turn-key="pending"]'));
  env.document.querySelector('[data-turn-key="pending"]').remove();
  await env.settle();
  assert.equal(buttons(env).length, 0);
  assertNoBar(first);
});

test("a previously folded turn is restored if its preview becomes unavailable", async t => {
  const env = await environment({ html: modernConversation(5) });
  t.after(env.close);
  const root = env.document.querySelector('[data-turn-key="turn-0"]');
  root.querySelector('[data-user-message-bubble="true"]').outerHTML = '<div data-user-message-bubble="true"><img alt="添付画像"></div>';
  await env.settle();
  assertNoBar(root);
  assert.equal(buttons(env).length, 3);
});


test("folds the first answer card and restores its form without losing interaction", async t => {
  const env = await environment({ html: conversationWithAnswerForm(6) });
  t.after(env.close);
  const first = env.document.querySelector('[data-turn-key="sample-0"]');
  const form = first.querySelector("form");
  const choice = form.querySelector("input");
  choice.checked = true;
  let clicks = 0;
  form.querySelector("button").addEventListener("click", () => clicks++);
  assert.equal(env.command().total, 6);
  assert.equal(buttons(env).length, 5);
  assert.equal(folded(env).length, 3);
  assert.notEqual(env.window.getComputedStyle(first).display, "none");
  assert.equal(first.firstElementChild.matches(".ctf-turn-bar"), true);
  assert.equal(env.window.getComputedStyle(form.parentElement).display, "none");
  assert.match(buttons(env)[0].textContent, /Sample prompt 0/);
  buttons(env)[0].click();
  assert.notEqual(env.window.getComputedStyle(form.parentElement).display, "none");
  assert.equal(first.querySelector("form"), form);
  assert.equal(choice.checked, true);
  form.querySelector("button").click();
  assert.equal(clicks, 1);
  assert.equal(env.command("collapse").collapsed, 5);
  assertNoBar(env.document.querySelector('[data-turn-key="sample-5"]'));
});


test("group controls participate in turn layout and fully restore when disabled", async t => {
  const env = await environment({ html: modernConversation(6) });
  t.after(env.close);
  const first = env.document.querySelector('[data-turn-key="turn-0"]');
  const prompt = first.querySelector('[data-user-message-bubble]');
  assert.notEqual(env.window.getComputedStyle(first).display, "none");
  assert.equal(env.window.getComputedStyle(prompt.parentElement).display, "none");
  assert.equal(first.firstElementChild.querySelector('button'), buttons(env)[0]);
  assert.equal(first.firstElementChild.parentElement, first);
  await env.setSettings({ enabled: false, keepRecent: 3 });
  assert.equal(env.document.querySelectorAll('[data-ctf-container], [data-ctf-collapsed], .ctf-turn-bar').length, 0);
  assert.notEqual(env.window.getComputedStyle(prompt.parentElement).display, "none");
  assert.equal(first.querySelector('[data-user-message-bubble]'), prompt);
});
