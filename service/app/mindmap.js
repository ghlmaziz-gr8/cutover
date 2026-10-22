// Mind map of the three approaches: a tree of labelled nodes with tones and icons.
// No drawing library. The page draws the tree as nested lists, so it works on a phone and with a screen reader.
// Run: node --test service/app/test/mindmap.test.mjs
(function (root) {
  const FIT = {
    recommended: { tone: "best", text: "Best fit for this application" },
    possible: { tone: "possible", text: "Possible fit" },
    weak: { tone: "weak", text: "Weaker fit" },
  };

  const leaves = (list, tone) => (list || []).map((t) => ({ kind: "leaf", tone, label: t }));

  // picks: Modernize.choose(findings) output, each with evidence, score and max.
  // points: the pros, cons and best-for of each approach, keyed by id.
  // chosenId: the approach the platform engineer chose, if any.
  function approach(picks, points, chosenId) {
    const list = Array.isArray(picks) ? picks : [];
    return {
      kind: "root",
      label: "Modernize the application",
      meta: `${list.length} approaches`,
      children: list.map((p, index) => {
        const pts = (points && points[p.id]) || {};
        const fit = FIT[p.fit] || { tone: "weak", text: "" };
        const groups = [];
        if ((p.evidence || []).length) {
          groups.push({ kind: "group", tone: "evidence", icon: "●", label: "Why it matches", children: leaves(p.evidence, "evidence") });
        }
        if ((pts.pros || []).length) groups.push({ kind: "group", tone: "pro", icon: "✓", label: "Pros", children: leaves(pts.pros, "pro") });
        if ((pts.cons || []).length) groups.push({ kind: "group", tone: "con", icon: "!", label: "Cons", children: leaves(pts.cons, "con") });
        if ((pts.best || []).length) groups.push({ kind: "group", tone: "fit", icon: "◎", label: "Best for", children: leaves(pts.best, "fit") });
        return {
          kind: "branch",
          id: p.id,
          label: p.title,
          tone: fit.tone,
          fitText: fit.text,
          score: p.score || 0,
          max: p.max || 0,
          chosen: !!chosenId && p.id === chosenId,
          index,
          children: groups,
        };
      }),
    };
  }

  root.MindMap = { approach };
})(typeof globalThis !== "undefined" ? globalThis : this);
