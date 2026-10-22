// Modernized templates: the three options, and the rules that pick one from the findings.
// No model is used. Each rule reads the findings the engine already produced, and the reasons shown to the
// reader are the rules that matched. Each template has its own preview page in templates/.
// Run: node --test service/app/test/modernize.test.mjs
(function (root) {
  const LEGACY_PAGES = /\bclassic asp\b|\bjsp\b|web forms|asp\.net|\.net framework|struts/i;

  // A finding counts as a point when the report says so and it has a severity or a value.
  function hasPoint(findings, id) {
    const item = findings && findings[id];
    if (!item || item.point === false) return false;
    if (item.severity) return true;
    const v = item.value;
    if (v === null || v === undefined || v === false || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }

  function valueText(findings, id) {
    const item = findings && findings[id];
    return item && item.point !== false ? JSON.stringify(item.value ?? null) : "";
  }

  const TEMPLATES = [
    {
      id: "web-modern",
      title: "Modern web front end over an API",
      href: "templates/web-modern.html",
      summary: "Rebuild the screens as a modern web front end, with a clean API in front of the existing data.",
      points: {
        pros: ["A modern look and page flow", "The data stays where it is, behind an API"],
        cons: ["The screens are rebuilt, not copied", "Needs front-end and API work"],
        best: ["Applications with legacy page code and many screens"],
      },
      rules: [
        { weight: 3, reason: "Legacy page code was found", test: (f) => LEGACY_PAGES.test(valueText(f, "legacy.languages")) || LEGACY_PAGES.test(valueText(f, "stack.languages")) },
        { weight: 2, reason: "Screens were found in the code", test: (f) => hasPoint(f, "ui.screens") || hasPoint(f, "ui.screen_names") },
        { weight: 1, reason: "Endpoints are exposed to users", test: (f) => hasPoint(f, "ui.endpoints") },
      ],
    },
    {
      id: "services-data",
      title: "Services over a modern database",
      href: "templates/services-data.html",
      summary: "Move business rules out of the database and into services, then move the data in steps.",
      points: {
        pros: ["Business rules move out of the database", "Data moves in steps"],
        cons: ["The longest route of the three", "Needs careful data checks at each step"],
        best: ["Applications whose logic lives in stored procedures or views"],
      },
      rules: [
        { weight: 3, reason: "Stored procedures or functions hold logic", test: (f) => hasPoint(f, "data.routines_in_code") || hasPoint(f, "legacy.views") },
        { weight: 2, reason: "The code reads and writes database tables", test: (f) => hasPoint(f, "data.tables_in_code") || hasPoint(f, "data.tables") || hasPoint(f, "legacy.databases") },
        { weight: 1, reason: "Schema migrations are kept in the code", test: (f) => hasPoint(f, "data.migrations") },
      ],
    },
    {
      id: "lift-contain",
      title: "Run as is, in containers",
      href: "templates/lift-contain.html",
      summary: "Run the application as it is, in containers, with its data unchanged. Modernize it later, one part at a time.",
      points: {
        pros: ["The lowest-risk first step", "The data is unchanged"],
        cons: ["The legacy code stays as it is", "Modernizing comes later, one part at a time"],
        best: ["Teams that need to leave the current host quickly"],
      },
      rules: [
        { weight: 1, reason: "The lowest-risk first step", general: true, test: () => true },
        { weight: 2, reason: "No infrastructure as code was found", test: (f) => !hasPoint(f, "infrastructure.as_code") },
        { weight: 2, reason: "Dependencies are listed for upgrade", test: (f) => hasPoint(f, "legacy.dependencies") },
      ],
    },
  ];

  // Returns every template with its score, the reasons that matched, and its fit. The best one is recommended.
  function choose(findings) {
    const scored = TEMPLATES.map((t) => {
      const matched = t.rules.filter((r) => {
        try { return r.test(findings || {}); } catch (e) { return false; }
      });
      return {
        id: t.id,
        title: t.title,
        href: t.href,
        summary: t.summary,
        score: matched.reduce((sum, r) => sum + r.weight, 0),
        max: t.rules.reduce((sum, r) => sum + r.weight, 0),
        reasons: matched.map((r) => r.reason),
        // Reasons that come from this application's findings. General reasons (true for every application) are left out.
        evidence: matched.filter((r) => !r.general).map((r) => r.reason),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    scored.forEach((s, i) => {
      s.fit = i === 0 ? "recommended" : s.score > 1 ? "possible" : "weak";
    });
    return scored;
  }

  const api = { choose, TEMPLATES: TEMPLATES.map(({ id, title, href, points }) => ({ id, title, href, points })) };
  root.Modernize = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
