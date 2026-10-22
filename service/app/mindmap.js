// Mind map of the three approaches: a plain tree built from the options and their points.
// No drawing library. The page renders the tree as nested lists, so it works on a phone.
// Run: node --test service/app/test/mindmap.test.mjs
(function (root) {
  const FIT = { recommended: "Best fit for this application", possible: "Possible fit", weak: "Weaker fit" };

  // picks: the list returned by Modernize.choose(findings), each with its points from TEMPLATES.
  // Returns { label, children } where each child is a node with its own children, or a leaf { label }.
  function approach(picks, points) {
    const list = Array.isArray(picks) ? picks : [];
    return {
      label: "Modernize the application",
      children: list.map((p) => {
        const pts = (points && points[p.id]) || {};
        const groups = [
          { label: "Pros", children: (pts.pros || []).map((t) => ({ label: t })) },
          { label: "Cons", children: (pts.cons || []).map((t) => ({ label: t })) },
          { label: "Best for", children: (pts.best || []).map((t) => ({ label: t })) },
        ].filter((g) => g.children.length);
        const reasons = (p.reasons || []).map((r) => ({ label: r }));
        return {
          id: p.id,
          label: p.title,
          tag: FIT[p.fit] || "",
          children: [
            ...(reasons.length ? [{ label: "Matches this application", children: reasons }] : []),
            ...groups,
          ],
        };
      }),
    };
  }

  root.MindMap = { approach };
})(typeof globalThis !== "undefined" ? globalThis : this);
