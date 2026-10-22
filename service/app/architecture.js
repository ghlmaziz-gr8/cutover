// Architecture diagram: the layers from the deeper assessment, each linked to the finding it came from.
// A layer that was not found shows as a placeholder, but only when the viewer may see its category.
// Built only from what the viewer may see. No model runs in the browser.
// Run: node --test service/app/test/architecture.test.mjs
(function (root) {
  const ORDER = ["Users", "Screens", "Services", "Data", "Hosting"];
  const TONE = { Users: "#7c3aed", Screens: "#0d9488", Services: "#2563eb", Data: "#16a34a", Hosting: "#b45309" };
  const CATEGORY = { Users: "ui_portal", Screens: "ui_portal", Services: "ui_portal", Data: "data", Hosting: "infrastructure" };
  const MISSING = "Not found in the code";

  // layers: [{ layer, detail, basis, category, items? }] from deeper.architecture.layers.
  // findings: the findings on the page, keyed by id, to name the source and its confidence.
  // canSee(category): true when the viewer may see that category. A layer they cannot see is left out entirely.
  // Returns one box per layer, in order. Hosting is last and drawn as a band across the bottom.
  function build(layers, findings, canSee) {
    const list = Array.isArray(layers) ? layers : [];
    const seen = typeof canSee === "function" ? canSee : () => true;
    const byName = new Map(list.map((l) => [l.layer, l]));
    const out = [];
    for (const name of ORDER) {
      const l = byName.get(name);
      if (!l && !seen(CATEGORY[name])) continue;
      const f = l && l.basis ? (findings && findings[l.basis]) || null : null;
      const verified = !!f && f.confidence === "verified";
      out.push({
        index: out.length,
        layer: name,
        detail: l ? (l.detail || "") : MISSING,
        items: l && Array.isArray(l.items) ? l.items.map(String) : [],
        tone: TONE[name],
        band: name === "Hosting",
        missing: !l,
        source: f ? f.title : null,
        confidence: l ? (f ? (verified ? "verified" : "inferred") : "unknown") : "missing",
      });
    }
    return out;
  }

  root.Architecture = { build, ORDER, TONE, CATEGORY };
})(typeof globalThis !== "undefined" ? globalThis : this);
