// Every model provider the Worker supports has a key quest, and every link in a quest is https.
// Run: node --test service/app/test/quests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../worker/src/index.mjs", import.meta.url), "utf8");

function quests() {
  const match = html.match(/const QUESTS = (\{[\s\S]*?\n  \});/);
  assert.ok(match, "QUESTS found in the app");
  return Function(`"use strict"; return (${match[1]});`)();
}

test("every provider the Worker supports has a key quest", () => {
  const block = worker.match(/const MODEL_PROVIDERS = \{([\s\S]*?)\n\};/);
  assert.ok(block, "MODEL_PROVIDERS found in the Worker");
  const providers = [...block[1].matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
  assert.ok(providers.length > 0);
  const q = quests();
  assert.deepEqual(Object.keys(q).sort(), providers.sort());
});

test("each quest has a title, at least three chapters, and its links are https", () => {
  for (const [id, quest] of Object.entries(quests())) {
    assert.ok(quest.title, id);
    assert.ok(quest.chapters.length >= 3, `${id} has chapters`);
    assert.ok(quest.epilogue, id);
    for (const c of quest.chapters) {
      assert.ok(c.name && c.text, `${id}: ${c.name}`);
      if (c.url) {
        assert.match(c.url, /^https:\/\//, `${id}: ${c.url}`);
        assert.ok(c.cta, `${id}: a link needs a button label`);
      }
    }
  }
});
