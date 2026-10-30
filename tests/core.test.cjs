const test = require("node:test");
const assert = require("node:assert/strict");
const { environment, article, modernConversation } = require("./helpers.cjs");

test("groups a user and all following assistant articles into a turn", async t => {
  const env = await environment({ content: false, html: article("assistant", "orphan") + article("user", "u") + article("assistant", "a1") + article("assistant", "a2") + article("user", "pending") });
  t.after(env.close);
  const turns = env.core.collectTurns(env.document.querySelector("main"));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].nodes.length, 3);
  assert.equal(turns[0].key, "u");
  assert.equal(turns[1].hasReply, false);
});

test("keeps the latest N turns and always protects the latest/pending turn", async t => {
  const env = await environment({ content: false });
  t.after(env.close);
  const turns = env.core.collectTurns(env.document.querySelector("main"));
  const state = { enabled: true, keepRecent: 3 };
  assert.deepEqual(Array.from(turns, (turn, i) => env.core.shouldCollapse(turn, i, turns, state, new Map())), [true, true, false, false, false]);
  const overrides = new Map(turns.map(turn => [turn.key, true]));
  assert.equal(env.core.shouldCollapse(turns[4], 4, turns, state, overrides), false);
  turns[0].hasReply = false;
  assert.equal(env.core.shouldCollapse(turns[0], 0, turns, state, overrides), false);
  assert.equal(env.core.shouldCollapse(turns[1], 1, turns, { ...state, enabled: false }, overrides), false);
});

test("uses individual markers in shared containers and leaves editable messages alone", async t => {
  const html = `<article><div data-message-author-role="user">u</div><div data-message-author-role="assistant">a</div></article>` +
    `<div data-message-author-role="user">no article</div>` +
    `<article><div data-message-author-role="user" contenteditable="true">editing</div></article>`;
  const env = await environment({ content: false, html });
  t.after(env.close);
  const turns = env.core.collectTurns(env.document.querySelector("main"));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].root.tagName, "DIV");
  assert.equal(turns[0].hasReply, true);
  assert.equal(turns[1].hasReply, false);
});

test("legacy roles without an article start a new turn instead of joining the previous turn", async t => {
  const html = article("user", "valid") + `<div data-message-author-role="user">unknown</div>` + article("assistant", "reply");
  const env = await environment({ content: false, html });
  t.after(env.close);
  const turns = env.core.collectTurns(env.document.querySelector("main"));
  assert.equal(turns[0].hasReply, false);
  assert.equal(turns[0].nodes.length, 1);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].hasReply, true);
});

for (const attribute of ["data-content-search-unit-key", "data-chatgpt-search-unit-key"]) {
  for (const grouped of [true, false]) {
    test(`recognizes ${attribute} with grouped=${grouped} and no legacy markers`, async t => {
      const env = await environment({ content: false, html: modernConversation(5, attribute, grouped) });
      t.after(env.close);
      assert.equal(env.document.querySelectorAll("article, [data-message-author-role]").length, 0);
      const turns = env.core.collectTurns(env.core.findScope(env.document));
      assert.equal(turns.length, 5);
      assert.equal(turns[0].hasReply, true);
      assert.equal(turns[0].nodes.length, grouped ? 1 : 2);
      assert.match(env.core.preview(turns[0].user), /質問 0/);
      assert.doesNotMatch(env.core.preview(turns[0].user), /返答/);
    });
  }
}

test("supports role-only virtualized shells and multiple assistant parts", async t => {
  const html = '<section data-turn="user" data-turn-id="u0"></section>' +
    '<section data-turn="assistant" data-turn-id="a0"></section>' +
    '<section data-turn="user" data-turn-id="u1">質問</section>' +
    '<section data-turn="assistant"><div data-message-author-role="assistant">考え中</div><div data-message-author-role="assistant">回答</div></section>';
  const env = await environment({ content: false, html });
  t.after(env.close);
  const turns = env.core.collectTurns(env.core.findScope(env.document));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].key, "u0");
  assert.equal(turns[0].hasReply, true);
  assert.equal(turns[1].nodes.length, 2);
});

test("supports a turn group identified by user bubbles and assistant markers", async t => {
  const env = await environment({ content: false, html: '<div data-turn-key="g"><div data-user-message-bubble="true">質問</div><div data-conversation-role="assistant">回答</div><div data-chatgpt-agent-turn-start>補足</div></div>' });
  t.after(env.close);
  const turns = env.core.collectTurns(env.core.findScope(env.document));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].key, "g");
  assert.equal(turns[0].hasReply, true);
});

test("finds a conversation outside main and excludes navigation and composer markers", async t => {
  const env = await environment({ content: false, html: "" });
  t.after(env.close);
  env.document.body.insertAdjacentHTML("beforeend", `<div data-thread-find-target="conversation">${modernConversation(2)}</div><aside>${modernConversation(1)}</aside><form>${modernConversation(1)}</form>`);
  const scope = env.core.findScope(env.document);
  assert.equal(scope.getAttribute("data-thread-find-target"), "conversation");
  assert.equal(env.core.collectTurns(scope).length, 2);
  scope.removeAttribute("data-thread-find-target");
  env.document.querySelector("main").remove();
  assert.equal(env.core.findScope(env.document), env.document.body);
  assert.equal(env.core.collectTurns(env.document.body).length, 2);
});

test("never treats a group containing several questions as a single collapsible turn", async t => {
  const env = await environment({ content: false, html: `<div data-turn-key="shared">${modernConversation(2)}</div>` });
  t.after(env.close);
  const turns = env.core.collectTurns(env.core.findScope(env.document));
  assert.equal(turns.length, 2);
  assert.notEqual(turns[0].key, "shared");
});

test("validates stored settings and bounds previews", async t => {
  const env = await environment({ content: false, html: article("user", "long", "x".repeat(10000)) });
  t.after(env.close);
  for (const value of [-1, 0, 51, 2.5, "bad", null]) {
    assert.equal(env.core.normalizeSettings({ keepRecent: value }).keepRecent, 3);
  }
  assert.equal(env.core.normalizeSettings({ keepRecent: "5", enabled: false }).keepRecent, 5);
  assert.equal(env.core.normalizeSettings({ enabled: "false" }).enabled, true);
  assert.equal(env.core.normalizeSettings(null).keepRecent, 3);
  assert.equal(env.core.preview(env.document.querySelector('[data-message-id="long"]')).length, 91);
});
