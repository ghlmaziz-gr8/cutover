// Cutover AI assessment: effort, resources and a project plan for the chosen approach.
// Built from the findings of one analysis by fixed rules. Every figure is a range in person-days.
// Nothing here is a quote. The engine and this file set the numbers; the page only shows them.
// Run: node --test service/app/test/effort.test.mjs
(function (root) {
  const LABEL = "Cutover AI assessment";

  // Person-days per unit, low and high, for each approach. Lift-and-contain moves the code as it is.
  const RATES = {
    "lift-contain": {
      screen: [0.5, 1], endpoint: [0, 0], routine: [0, 0], table: [0, 0.1], dependency: [0.25, 0.5],
      migrationBase: [0, 1], container: [5, 10], weeks: 6,
    },
    "web-modern": {
      screen: [3, 5], endpoint: [1, 2], routine: [1, 2], table: [0.25, 0.5], dependency: [0.5, 1],
      migrationBase: [5, 10], container: [0, 0], weeks: 12,
    },
    "services-data": {
      screen: [2, 3], endpoint: [1, 2], routine: [1.5, 3], table: [0.5, 1], dependency: [0.5, 1],
      migrationBase: [8, 15], container: [0, 0], weeks: 14,
    },
  };
  const TESTING = [0.2, 0.3];      // share of build effort spent on testing and fixes
  const MANAGEMENT = [0.1, 0.15];  // share spent on planning, reviews and governance
  const NEW_LANGUAGE = 1.25;       // a language the team does not use today costs more to write
  const PRODUCTIVITY = 0.8;        // share of a working week that goes into the build
  const TEAM_MIN = 2;
  const TEAM_MAX = 12;

  const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
  const round = (v) => Math.round(v * 10) / 10;
  const range = (pair, count, factor = 1) => [round(pair[0] * count * factor), round(pair[1] * count * factor)];
  const sum = (ranges) => [round(ranges.reduce((a, r) => a + r[0], 0)), round(ranges.reduce((a, r) => a + r[1], 0))];

  // facts: { template, screens, endpoints, routines: {procedures, functions, views}, tables, dependencies,
  //          databaseEngines, legacyLanguages: [names], targetLanguage: id|null, targetLabel, targetMatchesLegacy }
  function build(facts) {
    const f = facts || {};
    const template = RATES[f.template] ? f.template : null;
    const notes = [];
    if (!template) {
      return { label: LABEL, ready: false, message: "Choose an approach first. The estimate follows the approach." };
    }
    const R = RATES[template];
    const routines = f.routines || {};
    const procedures = num(routines.procedures), functions = num(routines.functions), views = num(routines.views);
    const routineCount = procedures + functions + views;
    const screens = num(f.screens), endpoints = num(f.endpoints), tables = num(f.tables), deps = num(f.dependencies);

    const languageFactor = template === "lift-contain" || f.targetMatchesLegacy === true ? 1 : NEW_LANGUAGE;
    if (template !== "lift-contain" && !f.targetLanguage) {
      notes.push("No target language is chosen yet, so the estimate assumes a language the team does not use today.");
    }
    if (template !== "lift-contain" && f.targetLanguage && f.targetMatchesLegacy === false) {
      notes.push(`The chosen language, ${f.targetLabel || f.targetLanguage}, is new to the team, so the build costs more.`);
    }
    if (!screens) notes.push("No screens were found in the code, so the screen work is not counted.");
    if (!tables && !routineCount) notes.push("No tables or stored routines were found, so the database work is limited to moving the data.");
    if (!endpoints && template !== "lift-contain") notes.push("No endpoints were counted, so the API work is not counted.");

    const coding = [
      { label: "Screens and pages", count: screens, unit: "screen", days: range(R.screen, screens, languageFactor) },
      { label: "Endpoints and controllers", count: endpoints, unit: "endpoint", days: range(R.endpoint, endpoints, languageFactor) },
      { label: "Programs and modules called", count: deps, unit: "module", days: range(R.dependency, deps, languageFactor) },
    ];
    if (template === "lift-contain") coding.push({ label: "Container packaging and configuration", count: 1, unit: "set", days: R.container.slice() });
    const codingBase = sum(coding.map((c) => c.days));

    const database = [
      { label: "Tables and schema", count: tables, unit: "table", days: range(R.table, tables, languageFactor) },
      { label: "Stored procedures, functions and views", count: routineCount, unit: "routine", days: range(R.routine, routineCount, languageFactor) },
      { label: "Data migration and checks", count: tables, unit: "table", days: [round(R.migrationBase[0] + tables * 0.1), round(R.migrationBase[1] + tables * 0.2)] },
    ];
    const databaseTotal = sum(database.map((d) => d.days));

    const testing = [round(codingBase[0] * TESTING[0]), round(codingBase[1] * TESTING[1])];
    const codingTotal = sum([codingBase, testing]);
    const management = [round((codingTotal[0] + databaseTotal[0]) * MANAGEMENT[0]), round((codingTotal[1] + databaseTotal[1]) * MANAGEMENT[1])];
    const grandTotal = sum([codingTotal, databaseTotal, management]);

    // Team: enough people to finish the build in the planned weeks, within limits.
    const midDays = (grandTotal[0] + grandTotal[1]) / 2;
    const build_weeks = R.weeks;
    const team = Math.min(TEAM_MAX, Math.max(TEAM_MIN, Math.ceil(midDays / (build_weeks * 5 * PRODUCTIVITY))));
    const fte = (n) => Math.round(n * 10) / 10;
    const resources = [
      { role: "Technical lead", fte: 1, why: "Owns the design and the decisions in the plan" },
      { role: "Developers", fte: fte(Math.max(1, team - 2)), why: "Build the screens, endpoints and integrations" },
      { role: "Testers", fte: fte(Math.max(1, Math.ceil(team * 0.25))), why: "Test each part and check it against the legacy behaviour" },
      { role: "Database engineer", fte: template === "lift-contain" ? 0.5 : 1, why: "Schema, routines and data migration" },
      { role: "Platform and delivery engineer", fte: template === "lift-contain" ? 0.5 : 1, why: "Environments, pipeline and cutover" },
      { role: "Business analyst", fte: 0.5, why: "Checks the behaviour with the application owner" },
      { role: "Application owner (client side)", fte: 0.2, why: "Approves decisions and tests the result" },
    ];

    // Plan phases, in order. Each phase's weeks come from its effort and the team on it.
    const phaseWeeks = (days) => Math.max(1, Math.ceil(((days[0] + days[1]) / 2) / (team * 5 * PRODUCTIVITY)));
    const tasksFor = (kind) => {
      const t = [];
      if (kind === "decide") {
        t.push("Confirm the approach and the target language", "Owner approves the language in Cutover", "Set up the environments and the delivery pipeline");
      }
      if (kind === "schema") {
        if (tables) t.push(`Move the schema of ${tables} tables`);
        if (tables) t.push("Plan the data migration and reconciliation checks");
        if (!tables) t.push("Confirm how the data is stored, since no tables were found");
      }
      if (kind === "logic") {
        if (routineCount) t.push(`Convert ${routineCount} stored procedures, functions and views`);
        else t.push("No stored routines to convert");
      }
      if (kind === "build") {
        if (template === "lift-contain") t.push("Package the application in containers", "Configure each environment");
        else {
          if (screens) t.push(`Rebuild ${screens} screens`);
          if (endpoints) t.push(`Build ${endpoints} endpoints`);
          if (deps) t.push(`Check ${deps} programs or modules called`);
        }
      }
      if (kind === "test") t.push("Test each part against the legacy behaviour", "Fix the defects found", "Run the data reconciliation");
      if (kind === "cutover") t.push("Rehearse the cutover", "Agree the go-live window and the rollback step", "Go live");
      if (kind === "hypercare") t.push("Watch the system closely and fix what users find", "Hand over to the operations team");
      return t;
    };
    // Database work is split into schema (tables and migration) and logic (routines). Each phase's weeks come from its own effort.
    const dbSchemaDays = sum([database[0].days, database[2].days]);
    const dbLogicDays = database[1].days;
    const cutoverWeeks = template === "lift-contain" ? 1 : 2;
    const raw = [
      { name: "Decisions and set-up", kind: "decide", days: null, fixed: template === "lift-contain" ? 1 : 2 },
      { name: "Database schema and data", kind: "schema", days: dbSchemaDays },
      { name: "Database logic", kind: "logic", days: dbLogicDays },
      { name: "Application build", kind: "build", days: codingBase },
      { name: "Testing and fixes", kind: "test", days: testing },
      { name: "Cutover and go-live", kind: "cutover", days: null, fixed: cutoverWeeks },
      { name: "Hypercare", kind: "hypercare", days: null, fixed: cutoverWeeks },
    ];
    let week = 1;
    const phases = raw.map((p) => {
      const weeks = p.fixed || phaseWeeks(p.days || [0, 0]);
      const out = { name: p.name, startWeek: week, weeks, endWeek: week + weeks - 1, tasks: tasksFor(p.kind) };
      week += weeks;
      return out;
    });
    const totalWeeks = week - 1;
    if (totalWeeks > build_weeks + 4) notes.push(`The plan runs ${totalWeeks} weeks, longer than the usual ${build_weeks} weeks for this approach, because the database logic and the testing take time.`);

    return {
      label: LABEL,
      ready: true,
      approach: template,
      method: "Rules applied to the findings of this analysis. A range, for planning and review.",
      unit: "person-days",
      coding: { items: coding, low: codingTotal[0], high: codingTotal[1], testing },
      database: { items: database, low: databaseTotal[0], high: databaseTotal[1] },
      management,
      total: { low: grandTotal[0], high: grandTotal[1] },
      team,
      resources,
      weeks: totalWeeks,
      phases,
      notes,
    };
  }

  root.Effort = { build, RATES, LABEL };
})(typeof globalThis !== "undefined" ? globalThis : this);
