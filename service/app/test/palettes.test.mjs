// Palette families: each family's light and dark sets must be readable, and the look must use one family at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../templates/palettes.js", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(src, { module, globalThis: {} });
const P = module.exports;

const ratio = (a, b) => P.contrast(a, b);

test("there are several families, each with a light and a dark set of all six colours", () => {
  assert.ok(P.FAMILIES.length >= 4);
  for (const f of P.FAMILIES) {
    assert.ok(f.name && f.note, f.id);
    for (const mode of ["light", "dark"]) {
      for (const [, key] of P.SLOTS) assert.match(f[mode][key], /^#[0-9a-f]{6}$/i, `${f.id} ${mode} ${key}`);
    }
  }
});

test("text, links and the on-primary label are readable in every family and mode", () => {
  for (const f of P.FAMILIES) {
    for (const mode of ["light", "dark"]) {
      const s = f[mode];
      const where = `${f.id} ${mode}`;
      assert.ok(ratio(s.text, s.page) >= 4.5, `${where}: text on page`);
      assert.ok(ratio(s.text, s.surface) >= 4.5, `${where}: text on surface`);
      assert.ok(ratio(s.links, s.page) >= 4.5, `${where}: links on page`);
      const on = P.onColour(s.primary, s.page);
      assert.ok(ratio(on, s.primary) >= 4.5, `${where}: label on primary`);
    }
  }
});

test("choosing a family writes all of its colours together, so one family is shown at a time", () => {
  const vars = P.cssVars(P.FAMILIES[1].light);
  assert.equal(vars["--p"], P.FAMILIES[1].light.primary);
  assert.equal(vars["--h"], P.FAMILIES[1].light.highlight);
  assert.equal(vars["--text"], P.FAMILIES[1].light.text);
  assert.equal(Object.keys(vars).length, 8);
});

test("the look uses the families, animates them and turns the motion off when asked", () => {
  const renderer = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../templates/preview.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../templates/web-modern.html", import.meta.url), "utf8");
  assert.ok(renderer.includes("window.CutoverPalettes") && renderer.includes("P.cssVars(set)"));
  assert.ok(html.indexOf("palettes.js") < html.indexOf("preview.js"), "palettes load before the renderer");
  assert.ok(css.includes("@property --p"), "the colours are registered so they glide");
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("the palette is set on the page root, so the wireframes below the look take it too", () => {
  const renderer = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../templates/preview.css", import.meta.url), "utf8");
  assert.ok(renderer.includes('document.getElementById("app")'), "the family is applied to the page root");
  assert.ok(css.includes("#app{") && css.includes("--accent:var(--p)"), "the page's tokens follow the family");
  assert.ok(css.includes("--grad:linear-gradient(120deg,var(--p)"), "gradients follow the family");
});
