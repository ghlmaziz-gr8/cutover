// Findings map: one branch per review card, with its findings under it, split by how sure we are.
// Built from the findings the viewer may see. Labels are finding titles and short values, as on the cards.
// Run: node --test service/app/test/findings-map.test.mjs
(function (root) {
  const CLEAR = "clear";

  // The worst severity in a card decides the branch colour.
  function worst(items) {
    if (items.some((i) => i.severity === "high")) return "high";
    if (items.some((i) => i.severity === "medium")) return "medium";
    if (items.length) return "low";
    return CLEAR;
  }

  // The leaf colour follows the severity: high is red, medium is amber, anything else is blue.
  function leafTone(severity) {
    if (severity === "high") return "con";
    if (severity === "medium") return "possible";
    return "fit";
  }

  function leaf(item) {
    return { kind: "leaf", tone: leafTone(item.severity), label: item.detail ? `${item.title}: ${item.detail}` : item.title };
  }

  // input.cards: [{ id, title, visible, items: [{ title, severity, confidence, detail }] }], one per review card.
  // A card the viewer may not see is listed as not shown, with no findings.
  function tree(input) {
    const cards = Array.isArray(input && input.cards) ? input.cards : [];
    return {
      kind: "root",
      label: (input && input.label) || "What we found",
      meta: `${cards.length} areas`,
      children: cards.map((card, index) => {
        if (!card.visible) {
          return { kind: "branch", link: false, id: card.id, label: card.title, tone: "hidden", fitText: "Not shown for your role", score: 0, max: 0, meterLabel: "", chosen: false, index, children: [] };
        }
        const items = card.items || [];
        const verified = items.filter((i) => i.confidence === "verified");
        const inferred = items.filter((i) => i.confidence !== "verified");
        const groups = [];
        if (verified.length) groups.push({ kind: "group", tone: "pro", icon: "✓", label: "Verified in code", children: verified.map(leaf) });
        if (inferred.length) groups.push({ kind: "group", tone: "fit", icon: "?", label: "Inferred, needs review", children: inferred.map(leaf) });
        const total = items.length;
        return {
          kind: "branch", link: false,
          id: card.id,
          label: card.title,
          tone: worst(items),
          fitText: total ? `${total} finding${total === 1 ? "" : "s"}` : "Nothing detected",
          // The meter shows verified findings, up to ten pips. Above ten it is left out and the count says it.
          score: verified.length,
          max: total <= 10 ? total : 0,
          meterLabel: `${verified.length} of ${total} verified in code`,
          chosen: false,
          index,
          children: groups,
        };
      }),
    };
  }

  root.FindingsMap = { tree };
})(typeof globalThis !== "undefined" ? globalThis : this);
