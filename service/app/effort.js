// Cutover AI assessment: effort, resources and a project plan, end to end.
// Built from this analysis only: the findings, the deeper assessment and what the code review could not read.
// Fixed rules turn those facts into ranges in person-days. A planning range for review, not a quote.
// Run: node --test service/app/test/effort.test.mjs
(function (root) {
  const LABEL = "Cutover AI assessment";
  const UNIT = "person-days";
  const WORK_DAYS = 5;
  const PRODUCTIVITY = 0.8;      // share of a working week that goes into delivery work
  const NEW_LANGUAGE = 1.25;     // a language the team does not use today costs more to write
  const DEV_MIN = 2;
  const DEV_MAX = 10;

  // Rates per approach: person-days per unit, as [low, high]. Lift-and-contain moves the code as it is.
  const RATES = {
    "lift-contain": {
      screenBuild: [0.5, 1], screenUx: [0, 0], endpoint: [0, 0], pageLogic: [0, 0], routine: [0, 0.1],
      table: [0, 0.1], migrationBase: [0, 1], dependency: [0.25, 0.5], container: [5, 10], weeks: 6,
      security: [1, 2], pentest: [1, 2], uat: [3, 5], training: [1, 2], cutover: [2, 4], codeReview: [0.01, 0.02],
      aiGain: [0.05, 0.1],
    },
    "web-modern": {
      screenBuild: [3, 5], screenUx: [0.5, 1], endpoint: [1, 2], pageLogic: [0.5, 1], routine: [1, 2],
      table: [0.25, 0.5], migrationBase: [5, 10], dependency: [0.5, 1], container: [0, 0], weeks: 12,
      security: [3, 5], pentest: [3, 5], uat: [5, 10], training: [2, 3], cutover: [3, 6], codeReview: [0.02, 0.04],
      aiGain: [0.15, 0.3],
    },
    "services-data": {
      screenBuild: [2, 3], screenUx: [0.25, 0.5], endpoint: [1, 2], pageLogic: [0.5, 1], routine: [1.5, 3],
      table: [0.5, 1], migrationBase: [8, 15], dependency: [0.5, 1], container: [0, 0], weeks: 14,
      security: [3, 5], pentest: [3, 5], uat: [5, 10], training: [2, 3], cutover: [3, 6], codeReview: [0.02, 0.04],
      aiGain: [0.15, 0.3],
    },
  };

  // Shared rules, whatever the approach.
  const SHARED = {
    testingShare: [0.2, 0.3],       // share of build effort spent on testing and fixes
    storiesPerScreen: 2,            // user stories per screen, before refinement
    storyDays: [0.1, 0.2],          // per user story, written and refined with the owner
    roleWorkshop: [0.5, 1],         // per role: a workshop on what that role does and sees
    architecture: [3, 5],           // target design and its decisions
    reviewFinding: [0.25, 0.5],     // per finding that needs a person to confirm it
    notReadFile: [0.02, 0.05],      // per file the code review could not read, read by hand
    accessSystem: [0.5, 1],         // per system an access grant is needed for
    accessCalendarDays: 5,          // an access request can take up to a working week
    onboarding: [1, 2],             // per person joining the team
    interviews: [2, 4],             // interviews with the people who know the legacy system
    accessDb: [3, 6],               // per Microsoft Access (or other file) database to read and move
    personalData: [3, 6],           // privacy review when personal data was found
    noPersonalData: [1, 2],
    documentation: [3, 6],
    gates: 4,                       // approval gates: scope, design, build-ready, go-live
    gatePrep: [1, 2],               // per gate: the presentation and the pack for the approver
    pmPerWeek: [0.5, 1],            // project management effort each week
    decommission: [2, 5],
    cutoverPlan: [3, 5],
    rehearsal: [1, 2],
    rollbackPlan: [1, 2],
    changeComms: [2, 4],
    pipelineMissing: [2, 4],
    iacMissing: [5, 10],
    userSupport: [1, 2],
  };

  // Scenario: where in each range the estimate sits. Lean is the low end, cautious the high end.
  const SCENARIO_T = { lean: 0, expected: 0.5, cautious: 1 };

  const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
  const r1 = (v) => Math.round(v * 10) / 10;
  const mid = (pair) => (pair[0] + pair[1]) / 2;
  const scale = (pair, n, f = 1) => [r1(pair[0] * n * f), r1(pair[1] * n * f)];
  const fixed = (pair) => [r1(pair[0]), r1(pair[1])];
  const add = (...pairs) => [r1(pairs.reduce((a, p) => a + p[0], 0)), r1(pairs.reduce((a, p) => a + p[1], 0))];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // facts: {
  //   template, screens, endpoints, controllers, routines: {procedures, functions, views}, tables, dependencies,
  //   roles, accessDbs, databaseEngines[], sourceFiles, notRead, needsReview, personalData (bool),
  //   hasIac, hasCi, hasContainers, targetLanguage, targetLabel, targetMatchesLegacy
  // }
  // The effort groups each scope includes. Deeper assessment is always in; Modernize and Migrate add their own groups.
  const SCOPE_GROUPS = {
    base: ["discovery", "access", "requirements", "governance", "ai"],
    modernize: ["build", "database", "testing", "security", "people"],
    migrate: ["database", "testing", "security", "cutover"],
  };
  // The effort group each plan phase belongs to. A phase is shown only when its group is in the scope.
  const PHASE_GROUP = {
    "Mobilise and grant access": "access",
    "Discover and confirm findings": "discovery",
    "Requirements and user stories": "requirements",
    "Platform and pipeline": "build",
    "Database build and migration": "database",
    "Application build": "build",
    "Security, privacy and integration review": "security",
    "Testing and acceptance": "testing",
    "Approvals and go/no-go": "governance",
    "Training and documentation": "people",
    "Cutover and go-live": "cutover",
    "Hypercare": "cutover",
    "Retire the legacy system": "cutover",
  };
  // The groups in a scope, such as "deeper_modernize_migrate". Null when no scope is chosen, so every group counts.
  function groupsInScope(scope) {
    if (!scope) return null;
    const parts = String(scope).split("_");
    const keys = new Set(SCOPE_GROUPS.base);
    if (parts.includes("modernize")) for (const k of SCOPE_GROUPS.modernize) keys.add(k);
    if (parts.includes("migrate")) for (const k of SCOPE_GROUPS.migrate) keys.add(k);
    return keys;
  }

  // options: { scenario: "lean" | "expected" | "cautious", shares: {groupKey: 0..1}, excluded: [labels], teamSize: n|null, scope: "deeper_modernize" | ... }
  function build(facts, options) {
    const f = facts || {};
    const opt = options || {};
    const excluded = new Set(opt.excluded || []);
    const inScope = groupsInScope(opt.scope);
    const pickT = (key) => (opt.shares && typeof opt.shares[key] === "number" ? Math.min(1, Math.max(0, opt.shares[key])) : SCENARIO_T[opt.scenario] ?? 0.5);
    const template = RATES[f.template] ? f.template : null;
    if (!template) return { label: LABEL, ready: false, message: "Choose an approach first. The estimate follows the approach." };
    const R = RATES[template];
    const lift = template === "lift-contain";
    const S = SHARED;

    const screens = num(f.screens), endpoints = num(f.endpoints), controllers = num(f.controllers);
    const routines = f.routines || {};
    const procedures = num(routines.procedures), functions = num(routines.functions), views = num(routines.views);
    const routineCount = procedures + functions + views;
    const tables = num(f.tables), deps = num(f.dependencies), roles = Math.max(num(f.roles), 1);
    const accessDbs = num(f.accessDbs), sourceFiles = num(f.sourceFiles), notRead = num(f.notRead), needsReview = num(f.needsReview);
    const stories = Math.max(screens, 1) * S.storiesPerScreen;
    const languageFactor = lift || f.targetMatchesLegacy === true ? 1 : NEW_LANGUAGE;
    const cutoverWeeks = lift ? 1 : 2;
    const notes = [
      "AI-assisted delivery is part of every estimate. Its saving is shown as a negative line, and the review it needs is counted.",
    ];

    // What the findings say, and what they could not say.
    if (!f.targetLanguage) notes.push("No target language is chosen yet. The build assumes a language the team does not use today.");
    else if (!lift && f.targetMatchesLegacy !== true) notes.push(`${f.targetLabel || "The chosen language"} is new to the team, so the build costs more.`);
    if (!screens) notes.push("No screens were found in the code, so screen work is not counted.");
    if (screens && !endpoints && !lift) notes.push("No REST endpoints were found. The server logic sits inside the pages, so each page is counted for moving its logic out.");
    if (accessDbs && !tables) notes.push(`${plural(accessDbs, "database file was", "database files were")} found but not read, so the table count is unknown. The schema work is an estimate until the files are read.`);
    if (!tables && !routineCount && !accessDbs) notes.push("No tables or stored routines were found, so the database work is limited to moving the data.");
    if (notRead) notes.push(`${plural(notRead, "file was", "files were")} listed but not read by the code review. They are read by hand in the discovery phase.`);
    if (needsReview) notes.push(`${plural(needsReview, "finding needs", "findings need")} a person to confirm it before the design is approved.`);
    if (!f.hasIac && !lift) notes.push("No infrastructure as code was found, so the cloud set-up is built from scratch.");
    if (!f.hasCi && !lift) notes.push("No build pipeline was found, so one is built as part of the set-up.");
    if (f.personalData) notes.push("Personal data was flagged in the code, so a privacy review is included with more time.");
    if (screens) notes.push(`The screen count of ${screens} is inferred from the files. Confirm the count with the team.`);

    // Effort, in groups. Each item: label, count, unit, days as [low, high].
    const groups = [];
    // Each item carries whether it is included, and its value at the chosen point of its range.
    const mark = (key, i) => {
      const included = !excluded.has(i.label) && (!inScope || inScope.has(key));
      const t = pickT(key);
      return { ...i, included, value: included ? r1(i.days[0] + (i.days[1] - i.days[0]) * t) : 0 };
    };
    const makeGroup = (key, title, items) => {
      const inc = items.filter((i) => i.included);
      const range = add(...inc.map((i) => i.days));
      return { key, title, items, low: range[0], high: range[1], value: r1(inc.reduce((a, i) => a + i.value, 0)) };
    };
    const group = (key, title, items) => {
      groups.push(makeGroup(key, title, items.filter((i) => i.days[1] > 0 || i.days[0] < 0).map((i) => mark(key, i))));
    };
    // Adds or replaces an item in a group by its label, at the top of the group.
    const upsert = (key, item) => {
      const g = groups.find((x) => x.key === key);
      const items = [mark(key, item), ...g.items.filter((i) => i.label !== item.label)];
      Object.assign(g, makeGroup(key, g.title, items));
    };
    const valueOf = (key) => groups.find((g) => g.key === key).value;

    group("discovery", "Discovery and assessment", [
      { label: "Confirm the findings that need review", count: needsReview, unit: "finding", days: scale(S.reviewFinding, needsReview) },
      { label: "Read the files the code review could not read", count: notRead, unit: "file", days: scale(S.notReadFile, notRead) },
      { label: "Review the source before it is changed", count: sourceFiles, unit: "source file", days: scale(R.codeReview, sourceFiles) },
      { label: "Interviews with people who know the legacy system", count: 1, unit: "round", days: fixed(S.interviews) },
    ]);

    group("access", "Mobilise, onboarding and access", [
      { label: "Access grants (repository, cloud, identity, tickets, legacy environment, production read)", count: 5 + accessDbs, unit: "system", days: scale(S.accessSystem, 5 + accessDbs) },
    ]);

    group("requirements", "Requirements, stories and design", [
      { label: "Stakeholder workshops, one per role", count: roles, unit: "role", days: scale(S.roleWorkshop, roles) },
      { label: "User stories, written and refined with the owner", count: stories, unit: "story", days: scale(S.storyDays, stories) },
      { label: "Target design and its decisions", count: 1, unit: "design", days: fixed(S.architecture) },
      { label: "Screen and experience design", count: screens, unit: "screen", days: scale(R.screenUx, screens) },
    ]);

    const coding = [
      { label: "Screens and pages rebuilt or moved", count: screens, unit: "screen", days: scale(R.screenBuild, screens, languageFactor) },
      { label: "Endpoints and controllers", count: endpoints, unit: "endpoint", days: scale(R.endpoint, endpoints, languageFactor) },
      { label: "Page logic moved out of the pages", count: lift || endpoints ? 0 : screens, unit: "page", days: lift || endpoints ? [0, 0] : scale(R.pageLogic, screens, languageFactor) },
      { label: "Programs and modules called", count: deps, unit: "module", days: scale(R.dependency, deps, languageFactor) },
      { label: "Roles and access mapped into the new system", count: roles, unit: "role", days: scale([0.5, 1], roles) },
    ];
    if (lift) coding.push({ label: "Container packaging and configuration", count: 1, unit: "set", days: fixed(R.container) });
    if (!lift && !f.hasIac) coding.push({ label: "Infrastructure as code, built from scratch", count: 1, unit: "set", days: fixed(S.iacMissing) });
    if (!f.hasCi) coding.push({ label: lift ? "Container build pipeline" : "Build and deploy pipeline", count: 1, unit: "pipeline", days: fixed(S.pipelineMissing) });
    group("build", "Application build", coding);
    const codingMid = [groups[groups.length - 1].low, groups[groups.length - 1].high];

    const database = [
      { label: "Tables and schema", count: tables, unit: "table", days: scale(R.table, tables, languageFactor) },
      { label: "Stored procedures, functions and views", count: routineCount, unit: "routine", days: scale(R.routine, routineCount, languageFactor) },
      { label: "Data migration and reconciliation", count: tables, unit: "table", days: [r1(R.migrationBase[0] + tables * 0.1), r1(R.migrationBase[1] + tables * 0.2)] },
      { label: "Move the database files found (Access or others)", count: accessDbs, unit: "file", days: scale(S.accessDb, accessDbs) },
    ];
    group("database", "Database", database);
    const dbMid = [groups[groups.length - 1].low, groups[groups.length - 1].high];

    const testing = [r1(codingMid[0] * S.testingShare[0]), r1(codingMid[1] * S.testingShare[1])];
    group("testing", "Testing and acceptance", [
      { label: "Testing and fixes on the build", count: 0, unit: "", days: testing },
      { label: "User acceptance testing with the stakeholders", count: 1, unit: "round", days: fixed(R.uat) },
      { label: "Performance and penetration testing", count: 1, unit: "round", days: fixed(R.pentest) },
      { label: "Data reconciliation checks", count: tables + accessDbs, unit: "check", days: scale([0.1, 0.3], tables + accessDbs) },
    ]);

    // AI-assisted delivery is part of every estimate: assessment, coding, testing, automation and documents.
    const buildR = [groups.find((g) => g.key === "build").low, groups.find((g) => g.key === "build").high];
    const testR = [groups.find((g) => g.key === "testing").low, groups.find((g) => g.key === "testing").high];
    // Lean pairs the low effort with the highest saving; cautious pairs the high effort with the lowest saving.
    const aiSaving = [r1(-(buildR[0] + testR[0]) * R.aiGain[1]), r1(-(buildR[1] + testR[1]) * R.aiGain[0])];
    group("ai", "AI-assisted delivery and automation", [
      { label: "AI tools set-up, guardrails and approved models", count: 1, unit: "set", days: fixed([1, 2]) },
      { label: "Automated regression and API tests, generated with AI and reviewed", count: screens + endpoints, unit: "item", days: scale([0.1, 0.2], screens + endpoints) },
      { label: "Automation routines: migration, reconciliation and deployment scripts", count: tables + accessDbs, unit: "routine", days: add(fixed([3, 5]), scale([0.2, 0.5], tables + accessDbs)) },
      { label: "Human review of AI-written code and tests", count: 1, unit: "review", days: [r1(buildR[0] * 0.1), r1(buildR[1] * 0.15)] },
      { label: "AI drafts of stories and documents, checked by their owners", count: stories, unit: "story", days: scale([0.02, 0.04], stories) },
      { label: "AI saving on build and testing", count: 0, unit: "", days: aiSaving },
    ]);
    group("security", "Security, privacy and integration", [
      { label: "Security review", count: 1, unit: "review", days: fixed(R.security) },
      { label: "Approve how AI tools may use code and data", count: 1, unit: "approval", days: fixed([0.5, 1]) },
      { label: f.personalData ? "Privacy review (personal data found)" : "Privacy check (none found)", count: 1, unit: "review", days: fixed(f.personalData ? S.personalData : S.noPersonalData) },
      { label: "Integrations and programs called, tested end to end", count: deps, unit: "module", days: scale([0.25, 0.5], deps) },
    ]);

    group("governance", "Approvals, communication and management", [
      { label: "Steering presentations and approval packs", count: S.gates, unit: "gate", days: scale(S.gatePrep, S.gates) },
      { label: "Change and communication to users", count: 1, unit: "plan", days: fixed(S.changeComms) },
    ]);

    group("people", "Training, documentation and change", [
      { label: "Training sessions, one set per role", count: roles, unit: "role", days: scale(R.training, roles) },
      { label: "Documentation for users and the operations team", count: 1, unit: "set", days: fixed(S.documentation) },
    ]);

    group("cutover", "Cutover and operations", [
      { label: "Cutover plan and go/no-go checklist", count: 1, unit: "plan", days: fixed(S.cutoverPlan) },
      { label: "Rehearsals of the cutover", count: 2, unit: "rehearsal", days: scale(S.rehearsal, 2) },
      { label: "Rollback plan", count: 1, unit: "plan", days: fixed(S.rollbackPlan) },
      { label: "Go-live support", count: 1, unit: "cutover", days: fixed(R.cutover) },
      { label: "Retire the legacy system", count: 1, unit: "system", days: fixed(S.decommission) },
    ]);

    // Team: enough developers to finish the build and database work in the planned weeks, within limits.
    const coreMid = valueOf("build") + valueOf("database") + valueOf("testing");
    const devs = Math.min(DEV_MAX, Math.max(DEV_MIN, Math.ceil(coreMid / (R.weeks * WORK_DAYS * PRODUCTIVITY))));
    const team = [
      { role: "Project manager", fte: 1, side: "delivery", why: "Plan, reporting, risks, and the gates in the plan" },
      { role: "Technical lead and architect", fte: 1, side: "delivery", why: "Owns the design, the decisions and the code review" },
      { role: "Business analyst", fte: screens || roles ? 1 : 0.5, side: "delivery", why: "User stories, workshops and acceptance criteria" },
      { role: "Product owner", fte: 0.5, side: "delivery", why: "Sets the priorities of the stories with the owner" },
      { role: "Developers", fte: devs, side: "delivery", why: "Build the screens, endpoints, logic and integrations" },
      { role: "UX designer", fte: screens && !lift ? 1 : 0, side: "delivery", why: "Screen and experience design for the new system" },
      { role: "Database engineer", fte: tables || routineCount || accessDbs ? 1 : 0.5, side: "delivery", why: "Schema, routines, migration and reconciliation" },
      { role: "QA engineers", fte: Math.max(1, Math.ceil(devs * 0.25)), side: "delivery", why: "Test each part against the legacy behaviour and the stories" },
      { role: "Platform and delivery engineer", fte: lift ? 0.5 : 1, side: "delivery", why: "Environments, pipeline, infrastructure and cutover" },
      { role: "Automation engineer", fte: lift ? 0.5 : 1, side: "delivery", why: "Builds the automated tests, the routines and the AI-assisted workflows" },
      { role: "Security engineer", fte: 0.5, side: "delivery", why: "Access design, security review and penetration test" },
      { role: "Change and training lead", fte: 0.5, side: "delivery", why: "Training, documentation and communication to users" },
      { role: "Application owner (client side)", fte: 0.2, side: "client", why: "Approves the gates and tests the result" },
      { role: "Stakeholder representatives (client side)", fte: r1(Math.min(3, roles) * 0.1), side: "client", why: "Workshops, reviews and acceptance" },
    ].filter((r) => r.fte > 0);
    // A team size chosen by the user scales every delivery role in the same proportion, in half-person steps.
    const deliveryFte = () => team.filter((r) => r.side === "delivery").reduce((a, r) => a + r.fte, 0);
    const autoHeadcount = Math.ceil(deliveryFte());
    if (opt.teamSize && autoHeadcount > 0) {
      const target = Math.max(1, Math.round(opt.teamSize));
      const k = target / deliveryFte();
      for (const r of team) if (r.side === "delivery") r.fte = Math.max(0.25, Math.round(r.fte * k * 4) / 4);
      // The developers take what is left, so the team is the size chosen, unless the other roles already need more.
      const devRole = team.find((r) => r.side === "delivery" && r.role === "Developers");
      if (devRole) {
        const others = deliveryFte() - devRole.fte;
        devRole.fte = Math.max(0.25, Math.round((target - others) * 4) / 4);
      }
    }
    const headcount = Math.ceil(deliveryFte());

    // Onboarding is per person in the team.
    const onboard = scale(S.onboarding, headcount);
    upsert("access", { label: "Team onboarding", count: headcount, unit: "person", days: onboard });

    // Plan: phases in order. Weeks come from effort, shared by the whole team.
    const weeksFor = (days) => Math.max(1, Math.ceil(days / (headcount * WORK_DAYS * PRODUCTIVITY)));
    const sumOf = (key) => valueOf(key);
    const accessWeeks = Math.max(1, Math.ceil((5 + accessDbs) / 4)) + (S.accessCalendarDays > 5 ? 1 : 0);
    const phaseDefs = [
      { name: "Mobilise and grant access", weeks: accessWeeks,
        tasks: [`Onboard ${headcount} people and set up their accounts`, `Request access to ${5 + accessDbs} systems and confirm each one works`, "Agree the working rhythm, the stakeholders and the meeting plan", "Set up the AI-assisted tools with approved models and guardrails"],
        deliverables: ["Team charter", "Access register"], approvals: ["Application owner confirms the team and the access"] },
      { name: "Discover and confirm findings", weeks: weeksFor(sumOf("discovery")),
        tasks: [`Confirm ${needsReview} findings that need a person`, `Read ${notRead} files by hand`, "Interview the people who know the legacy system", "Review the source before any change"],
        deliverables: ["Confirmed findings", "Code review notes"], approvals: ["Application owner confirms the scope"] },
      { name: "Requirements and user stories", weeks: weeksFor(sumOf("requirements")),
        tasks: [`Run ${roles} workshops, one per role`, `Write and refine ${stories} user stories`, "AI drafts the user stories, which the business analyst checks", "Agree the acceptance criteria for each story", "Target design written and reviewed"],
        deliverables: ["User stories", "Design document", "Steering presentation: scope and design"], approvals: ["Gate 1 (scope) and gate 2 (design) approved by the owner or a CIO or CTO"] },
      { name: "Platform and pipeline", weeks: weeksFor(sumOf("build") * 0.3),
        tasks: [f.hasIac ? "Extend the existing infrastructure as code" : "Build the infrastructure as code", f.hasCi ? "Extend the existing pipeline" : "Build the build and deploy pipeline", "Set up the environments: test, staging and the cutover target"],
        deliverables: ["Environments", "Pipeline", "Infrastructure code"], approvals: ["Platform owner signs off the environments"] },
      { name: "Database build and migration", weeks: weeksFor(sumOf("database")),
        tasks: [tables ? `Move the schema of ${tables} tables` : "Read the database files and confirm the tables", routineCount ? `Convert ${routineCount} stored procedures, functions and views` : "No stored routines to convert", accessDbs ? `Move ${accessDbs} database file${accessDbs === 1 ? "" : "s"} into the target store` : "Plan the data migration and its checks", "Reconcile the data between old and new", "Automated migration and reconciliation routines, run from the pipeline"],
        deliverables: ["Schema", "Migration scripts", "Reconciliation report"], approvals: ["Database owner approves the schema"] },
      { name: "Application build", weeks: weeksFor(sumOf("build")),
        tasks: lift ? ["Package the application in containers", "Configure each environment", "AI-assisted changes, with a person reviewing each one"] : [`Rebuild ${screens} screens`, endpoints ? `Build ${endpoints} endpoints` : "Move the server logic out of the pages", `Check ${deps} programs and modules called`, "Map the roles and access into the new system", "AI-assisted coding, with a person reviewing each change"],
        deliverables: ["Working build in test", "Build notes"], approvals: ["Gate 3 (build ready) approved by the owner"] },
      { name: "Security, privacy and integration review", weeks: weeksFor(sumOf("security")),
        tasks: ["Approve how AI tools may use code and data", "Security review of the build and the access design", f.personalData ? "Privacy review of the personal data" : "Confirm that no personal data is held", "Test each integration end to end"],
        deliverables: ["Security review", "Privacy note"], approvals: ["Security and privacy owners sign off"] },
      { name: "Testing and acceptance", weeks: weeksFor(sumOf("testing")),
        tasks: ["Test each part against the legacy behaviour and the stories", "Automated regression suite runs on every build", "Fix the defects found and retest", "Run the performance and penetration tests", "User acceptance testing with the stakeholders"],
        deliverables: ["Test results", "Automated test suite", "Acceptance sign-off"], approvals: ["Stakeholders accept the test results"] },
      { name: "Approvals and go/no-go", weeks: 1,
        tasks: ["Gate 4 (go-live) steering presentation", "Go/no-go checklist reviewed", "Approval recorded in Cutover"],
        deliverables: ["Go-live pack", "Approval record"], approvals: ["Gate 4 (go-live) approved by the owner or a CIO or CTO"] },
      { name: "Training and documentation", weeks: weeksFor(sumOf("people")),
        tasks: [`Run training for ${roles} roles`, "Write the user and operations documentation", "Send the change communication to users"],
        deliverables: ["Training material", "User guide", "Operations runbook"], approvals: ["Application owner approves the documentation"] },
      { name: "Cutover and go-live", weeks: cutoverWeeks,
        tasks: ["Rehearse the cutover twice", "Agree the go-live window and the rollback step", "Go live"],
        deliverables: ["Cutover plan", "Rehearsal notes"], approvals: ["Go/no-go decision recorded"] },
      { name: "Hypercare", weeks: cutoverWeeks,
        tasks: ["Watch the system closely and fix what users find", "Hand over to the operations team"],
        deliverables: ["Hypercare log", "Handover"], approvals: ["Operations team accepts the handover"] },
      { name: "Retire the legacy system", weeks: 1,
        tasks: ["Archive the legacy code and data as agreed", "Remove the legacy access", "Close the project and review the lessons"],
        deliverables: ["Closure report", "Lessons learned"], approvals: ["Application owner closes the project"] },
    ];
    // Who works on each phase, and which effort group it draws on.
    const META = {
      "Mobilise and grant access": { effort: "access", owners: ["Project manager", "Technical lead and architect", "Security engineer"] },
      "Discover and confirm findings": { effort: "discovery", owners: ["Business analyst", "Technical lead and architect", "Developers"] },
      "Requirements and user stories": { effort: "requirements", owners: ["Business analyst", "Product owner", "UX designer"] },
      "Platform and pipeline": { effort: "build", owners: ["Platform and delivery engineer"] },
      "Database build and migration": { effort: "database", owners: ["Database engineer", "Developers"] },
      "Application build": { effort: "build", owners: ["Developers", "Technical lead and architect"] },
      "Security, privacy and integration review": { effort: "security", owners: ["Security engineer", "Technical lead and architect"] },
      "Testing and acceptance": { effort: "testing", owners: ["QA engineers", "Product owner"] },
      "Approvals and go/no-go": { effort: "governance", owners: ["Project manager", "Application owner (client side)"] },
      "Training and documentation": { effort: "people", owners: ["Change and training lead"] },
      "Cutover and go-live": { effort: "cutover", owners: ["Platform and delivery engineer", "Project manager"] },
      "Hypercare": { effort: null, owners: ["Developers", "QA engineers"] },
      "Retire the legacy system": { effort: null, owners: ["Platform and delivery engineer", "Project manager"] },
    };
    let week = 1;
    const phases = phaseDefs.map((p) => {
      const meta = META[p.name] || { effort: null, owners: [] };
      const out = {
        name: p.name, startWeek: week, endWeek: week + p.weeks - 1, weeks: p.weeks, tasks: p.tasks, deliverables: p.deliverables, approvals: p.approvals,
        owners: meta.owners, days: meta.effort ? sumOf(meta.effort) : 0, gate: p.approvals.some((a) => /Gate|gate/.test(a)),
      };
      week += p.weeks;
      return out;
    });
    const weeks = week - 1;

    // Project management runs for the whole plan.
    const pm = scale(S.pmPerWeek, weeks);
    upsert("governance", { label: "Project management and status reporting", count: weeks, unit: "week", days: pm });
    const total = add(...groups.map((g) => [g.low, g.high]));
    if (weeks > R.weeks + 6) notes.push(`The plan runs ${weeks} weeks, longer than the usual ${R.weeks} weeks for this approach, because discovery, the database and the approvals take time.`);

    const assumptions = [
      `Days are person-days. A week is ${WORK_DAYS} working days, and ${Math.round(PRODUCTIVITY * 100)}% of it goes into delivery.`,
      `Each access request can take up to a working week. The mobilise phase allows for it.`,
      "The team starts together, and the people who know the legacy system give time for interviews and reviews.",
      `There are ${S.gates} approval gates: scope, design, build ready and go-live. Each is approved by the application owner, or a CIO or CTO, as set in Cutover.`,
      "Stakeholders give two hours a week to workshops and reviews.",
      `AI assistance saves ${Math.round(R.aiGain[0] * 100)}–${Math.round(R.aiGain[1] * 100)}% of the build and testing effort. The team reviews every AI-written change, and that review is counted.`,
      "Automation is built as the project goes: regression tests, migration and reconciliation routines, and the deployment scripts.",
      "Hosting, AI tool licences, model usage costs and contractor rates are not included.",
      "The rates are planning figures from the approach. They are not calibrated against past projects of this kind yet.",
    ];

    return {
      label: LABEL,
      ready: true,
      approach: template,
      scenario: opt.scenario || "expected",
      shares: opt.shares || {},
      excluded: [...excluded],
      teamSize: opt.teamSize || null,
      autoHeadcount,
      method: "Fixed rules applied to the findings of this analysis, the deeper assessment and the files the code review could not read. A planning range for review.",
      unit: UNIT,
      basis: { screens, endpoints, controllers, routineCount, tables, dependencies: deps, roles, accessDbs, sourceFiles, notRead, needsReview },
      groups,
      total: { low: total[0], high: total[1], value: r1(groups.reduce((a, g) => a + g.value, 0)) },
      headcount,
      team,
      weeks,
      phases: inScope ? phases.filter((p) => !PHASE_GROUP[p.name] || inScope.has(PHASE_GROUP[p.name])) : phases,
      assumptions,
      notes,
    };
  }

  root.Effort = { build, RATES, SHARED, LABEL, SCOPE_GROUPS, groupsInScope };
})(typeof globalThis !== "undefined" ? globalThis : this);
