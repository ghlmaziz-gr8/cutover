// Every provider's key story comes from the Worker's registry, and every link in a story is https.
// The app builds the stories from that list, so it keeps no copy of its own.
// Run: node --test service/app/test/quests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const { MODEL_PROVIDERS } = await import("../../worker/src/model-providers.mjs");

test("the app keeps no copy of the quests: it reads them from the Worker's provider list", () => {
  assert.ok(!/const QUESTS\b/.test(html), "no hard-coded quest table in the app");
  assert.ok(html.includes("p.quest"), "the quest panel is built from each provider's quest");
});

test("every provider has a key story with a title, a prologue, chapters and an epilogue", () => {
  for (const [id, p] of Object.entries(MODEL_PROVIDERS)) {
    const quest = p.quest;
    assert.ok(quest.title, id);
    assert.ok(quest.prologue, `${id} has a prologue`);
    assert.ok(quest.epilogue, `${id} has an epilogue`);
    assert.ok(quest.chapters.length >= 3, `${id} has chapters`);
    for (const c of quest.chapters) {
      assert.ok(c.name && c.text, `${id}: ${c.name}`);
      if (c.url) {
        assert.match(c.url, /^https:\/\//, `${id}: ${c.url}`);
        assert.ok(c.cta, `${id}: a link needs a button label`);
      }
    }
  }
});

test("the form offers the custom fields and a model box for every provider", () => {
  for (const id of ["modelProvider", "modelProviderName", "modelProviderAddress", "modelName", "modelKeyInput"]) {
    assert.ok(html.includes(`"${id}"`), `${id} is created in the form`);
  }
});
