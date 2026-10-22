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
        icon: iconFor(name),
        itemIcons: l && Array.isArray(l.items) ? l.items.map((x) => iconForItem(x)) : [],
        tone: TONE[name],
        band: name === "Hosting",
        missing: !l,
        source: f ? f.title : null,
        confidence: l ? (f ? (verified ? "verified" : "inferred") : "unknown") : "missing",
      });
    }
    return out;
  }

  // Line icons on a 24 x 24 grid, drawn with currentColor. Only these markup strings are ever inserted as icons.
  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    plug: '<path d="M9 2v5M15 2v5"/><path d="M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  };
  const LAYER_ICON = { Users: "user", Screens: "monitor", Services: "server", Data: "database", Hosting: "cloud" };

  // The icon for a layer, or for one item inside it, read from the words in the item.
  function iconFor(layer) {
    return LAYER_ICON[layer] || "code";
  }
  function iconForItem(text) {
    const t = String(text || "");
    if (/role|access|sign.?in|login|auth|permission/i.test(t)) return "shield";
    if (/database|table|sql|\bdb\b|data|store|schema/i.test(t)) return "database";
    if (/api|endpoint|controller|service|route|rest/i.test(t)) return "server";
    if (/screen|page|form|view|template|html|\.asp|\.jsp|\.aspx/i.test(t)) return "monitor";
    if (/integrat|program|module|depend|call|interface|queue|plug|library/i.test(t)) return "plug";
    if (/container|cloud|host|azure|aws|google|docker|kubernetes|server/i.test(t)) return "cloud";
    return "code";
  }

  root.Architecture = { build, ORDER, TONE, CATEGORY, ICONS, iconFor, iconForItem };
})(typeof globalThis !== "undefined" ? globalThis : this);
