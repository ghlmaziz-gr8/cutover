// Architecture diagram: the layers from the deeper assessment, each linked to the finding it came from.
// Built only from what the viewer may see (the server filters the layers by role). No model runs in the browser.
// Run: node --test service/app/test/architecture.test.mjs
(function (root) {
  const ORDER = ["Users", "Screens", "Services", "Data", "Hosting"];
  const TONE = { Users: "#7c3aed", Screens: "#0d9488", Services: "#2563eb", Data: "#16a34a", Hosting: "#b45309" };

  // layers: [{ layer, detail, basis, category }] from deeper.architecture.layers.
  // findings: the findings on the page, keyed by id, to name the source and its confidence.
  // Returns boxes in order. Hosting is kept last and drawn as a band across the bottom.
  function build(layers, findings) {
    const list = Array.isArray(layers) ? layers : [];
    const sorted = list.slice().sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer));
    return sorted.map((l, i) => {
      const f = (findings && findings[l.basis]) || null;
      const verified = !!f && f.confidence === "verified";
      return {
        index: i,
        layer: l.layer,
        detail: l.detail || "",
        tone: TONE[l.layer] || "#6d28d9",
        band: l.layer === "Hosting",
        source: f ? f.title : null,
        basis: l.basis || "",
        confidence: f ? (verified ? "verified" : "inferred") : "unknown",
      };
    });
  }

  root.Architecture = { build, ORDER, TONE };
})(typeof globalThis !== "undefined" ? globalThis : this);
