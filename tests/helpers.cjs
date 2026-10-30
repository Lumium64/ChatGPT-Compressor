const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = name => fs.readFileSync(path.join(root, name), "utf8");

function article(role, id, text = `${role} ${id}`) {
  return `<article data-testid="conversation-turn-${id}"><div data-message-author-role="${role}" data-message-id="${id}"><p>${text}</p></div></article>`;
}

function conversation(count = 5) {
  return Array.from({ length: count }, (_, i) => article("user", `u${i}`) + article("assistant", `a${i}`)).join("");
}

// Synthetic fixtures based on the reported new renderer's structural markers.
// They intentionally contain no article, conversation-turn test ID, or legacy role.
function modernTurn(index, attribute = "data-content-search-unit-key", grouped = true) {
  return `<div ${grouped ? `data-turn-key="turn-${index}"` : 'class="exchange"'}>
    <div ${attribute}="turn-${index}:0:user"><div data-user-message-bubble="true">質問 ${index}</div></div>
    <div ${attribute}="turn-${index}:1:assistant"><p>返答 ${index}</p></div>
  </div>`;
}

function modernConversation(count = 5, attribute, grouped) {
  return Array.from({ length: count }, (_, i) => modernTurn(i, attribute, grouped)).join("");
}

// A generic fixture: accessibility labels are siblings of message wrappers,
// and an answer card contains a form. No captured conversation content is used.
function conversationWithAnswerForm(count = 5) {
  return Array.from({ length: count }, (_, i) => `<div data-turn-key="sample-${i}">
    <h4 class="sr-only" data-conversation-role="user">Speaker</h4>
    <div data-chatgpt-search-unit-key="sample-${i}:0:user">
      <div data-content-search-unit-key="sample-${i}:0:user"><div data-user-message-bubble="true">Sample prompt ${i}</div></div>
    </div>
    <span hidden data-chatgpt-agent-turn-start></span>
    <div data-chatgpt-search-unit-key="sample-${i}:1:assistant" data-content-search-unit-key="sample-${i}:1:assistant">
      <h4 class="sr-only" data-conversation-role="assistant">Assistant</h4>
      <p>Sample reply ${i}</p>
      ${i === 0 ? '<form><label><input type="radio" name="choice" value="sample">Sample option</label><button type="button">Choose</button></form>' : ''}
    </div>
  </div>`).join("");
}

async function environment({ html = conversation(), settings, content = true } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(`<!doctype html><html><head><style>${source("content.css")}</style></head><body><main>${html}</main><textarea id="composer"></textarea></body></html>`, {
    url: "https://chatgpt.com/c/test", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  const listeners = [];
  let receive;
  let stored = settings;
  window.chrome = {
    runtime: { onMessage: { addListener(fn) { receive = fn; } } },
    storage: {
      local: {
        async get() { return { turnFoldSettings: stored }; },
        async set(value) {
          const oldValue = stored;
          stored = value.turnFoldSettings;
          listeners.forEach(fn => fn({ turnFoldSettings: { oldValue, newValue: stored } }, "local"));
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    }
  };
  window.eval(source("core.js"));
  if (content) window.eval(source("content.js"));
  await new Promise(resolve => setTimeout(resolve, 0));
  return {
    window, document: window.document, core: window.ChatGPTCompressor,
    close: () => {
      window.dispatchEvent(new window.PageTransitionEvent("pagehide", { persisted: false }));
      window.close();
      assert.deepEqual(errors, [], "content script should not throw uncaught errors");
    },
    command(action = "status") {
      let result;
      receive({ type: "ctf:command", action }, {}, value => { result = value; });
      return result;
    },
    setSettings: value => window.chrome.storage.local.set({ turnFoldSettings: value }),
    settle: () => new Promise(resolve => setTimeout(resolve, 180))
  };
}

module.exports = { source, article, conversation, modernTurn, modernConversation, conversationWithAnswerForm, environment };
