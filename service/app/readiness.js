// How ready the draft feature groups are for a vibe-coding tool to build from. Each feature gets four checks; the
// score is the share of checks that pass. Pure, so the tests can run it. Sample data only; no agent or model is named.
(function (root) {
  const keyOf = (r) => `${r.file} · ${r.id}`;
  const plural = (n, one, many) => (n === 1 ? one : many);

  // groups: the draft's features, each with stories, and each story with the rules it cites.
  function assess(groups) {
    const list = (Array.isArray(groups) ? groups : []).filter((g) => g && typeof g === "object");
    // Which features cite each rule, so a rule used by two features is found.
    const owners = new Map();
    list.forEach((g, i) => {
      for (const st of g.stories || []) {
        for (const r of st.rules || []) {
          const k = keyOf(r);
          if (!owners.has(k)) owners.set(k, new Set());
          owners.get(k).add(i);
        }
      }
    });
    const features = list.map((g, i) => {
      const stories = g.stories || [];
      const rules = stories.flatMap((st) => st.rules || []);
      const shared = [...new Set(rules.filter((r) => owners.get(keyOf(r)).size > 1).map(keyOf))];
      const checks = [
        { ok: stories.length > 0, text: stories.length ? `${stories.length} user ${plural(stories.length, "story", "stories")}` : "No user stories yet" },
        { ok: stories.length > 0 && stories.every((st) => (st.rules || []).length > 0), text: "Every story points to a rule in the code" },
        { ok: rules.length > 0 && rules.every((r) => Array.isArray(r.lines)), text: "Every cited rule has its source lines" },
        { ok: shared.length === 0, text: shared.length ? `${shared.length} ${plural(shared.length, "rule is", "rules are")} also used by another feature` : "No rule is shared with another feature" },
      ];
      return { name: g.name || `Feature ${i + 1}`, checks, passed: checks.filter((c) => c.ok).length, total: checks.length, shared };
    });
    const total = features.reduce((a, f) => a + f.total, 0);
    const passed = features.reduce((a, f) => a + f.passed, 0);
    const score = total ? Math.round((100 * passed) / total) : 0;
    const verdict = score >= 85 ? "favourable" : score >= 60 ? "review" : "not-ready";
    const label = { favourable: "Favourable for a vibe-coding tool", review: "Usable after a review", "not-ready": "Not ready yet: fix the gaps first" }[verdict];
    const stories = list.reduce((a, g) => a + (g.stories || []).length, 0);
    return { score, verdict, label, features, stories };
  }

  root.Readiness = { assess };
})(typeof globalThis !== "undefined" ? globalThis : this);
