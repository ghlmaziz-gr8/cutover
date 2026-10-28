// The effort of each feature, with and without Cutover's AI-assisted delivery. Built from the same rates as the
// whole-application assessment in effort.js, applied to what one feature holds: its user stories, its files (each
// treated as one page), the functions in those files and the tables they use. Pure, so the tests can run it.
// Person-days in, hours out at 8 hours a day. A planning figure for review, not a quote.
(function (root) {
  const HOURS_PER_DAY = 8;
  const DEFAULT_TEMPLATE = "web-modern";
  const REVIEW_OF_AI_CODE = 0.1;   // a person reviews the code the AI wrote: 10% of the build

  const mid = (pair) => (pair[0] + pair[1]) / 2;
  const r1 = (v) => Math.round(v * 10) / 10;
  const count = (v) => (Array.isArray(v) ? v.length : 0);

  // What one feature holds, read from its approved files.
  function factsOf(feature) {
    const files = Array.isArray(feature.files) ? feature.files : [];
    const tables = new Set();
    let functions = 0;
    for (const file of files) {
      const a = file.assessment;
      if (!a) continue;
      functions += count(a.functions);
      const db = a.database || {};
      for (const t of Array.isArray(db.tables) ? db.tables : []) if (t && t.name) tables.add(String(t.name).toLowerCase());
    }
    return {
      stories: Math.max(count(feature.stories), 0),
      screens: files.length,
      functions,
      tables: tables.size,
    };
  }

  // The effort of one feature, by the approach's rates. Returns person-days, hours and the share saved.
  function forFeature(feature, template) {
    const E = root.Effort;
    const key = E && E.RATES[template] ? template : DEFAULT_TEMPLATE;
    const R = E.RATES[key];
    const S = E.SHARED;
    const f = factsOf(feature || {});
    const lift = key === "lift-contain";
    // Requirements: the stories, and the design of each page.
    const requirements = f.stories * mid(S.storyDays) + f.screens * mid(R.screenUx);
    // Build: each page, its page logic (none for lift-and-contain, which moves the code as it is), and its functions.
    const build = f.screens * mid(R.screenBuild) + (lift ? 0 : f.screens * mid(R.pageLogic)) + f.functions * mid(R.routine);
    // Database: each table, and its migration.
    const database = f.tables * mid(R.table) + f.tables * 0.15;
    // Testing: a share of the build and the database.
    const testing = (build + database) * mid(S.testingShare);
    const manual = requirements + build + database + testing;
    // AI-assisted: the saving on build and testing, less the review a person gives the code the AI wrote.
    const saving = (build + testing) * mid(R.aiGain);
    const review = build * REVIEW_OF_AI_CODE;
    const withCutover = manual - saving + review;
    const saved = manual - withCutover;
    return {
      stories: f.stories,
      screens: f.screens,
      functions: f.functions,
      tables: f.tables,
      manualDays: r1(manual),
      cutoverDays: r1(withCutover),
      savedDays: r1(saved),
      manualHours: Math.round(manual * HOURS_PER_DAY),
      cutoverHours: Math.round(withCutover * HOURS_PER_DAY),
      savedHours: Math.round(saved * HOURS_PER_DAY),
      savedPercent: manual > 0 ? Math.round((saved / manual) * 100) : 0,
    };
  }

  // The effort of a capability: its features added together.
  function forCapability(features, template) {
    const parts = (Array.isArray(features) ? features : []).map((f) => forFeature(f, template));
    const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
    const manualDays = sum("manualDays"), savedDays = sum("savedDays"), cutoverDays = sum("cutoverDays");
    return {
      features: parts.length,
      manualHours: Math.round(manualDays * HOURS_PER_DAY),
      cutoverHours: Math.round(cutoverDays * HOURS_PER_DAY),
      savedHours: Math.round(savedDays * HOURS_PER_DAY),
      savedPercent: manualDays > 0 ? Math.round((savedDays / manualDays) * 100) : 0,
    };
  }

  root.FeatureEffort = { forFeature, forCapability, factsOf, HOURS_PER_DAY };
})(typeof globalThis !== "undefined" ? globalThis : this);
