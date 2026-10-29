// Renders one modernized template preview. Each page sets data-template on #app. The review links here with
// ?fit=recommended|possible|weak (this template's fit) and &rec=<id> (the template recommended for the application).
// The other two options are shown behind the proposal, so the reader can compare them.
// Run: node --test service/app/test/modernize.test.mjs
(function () {
  const T = {
    "web-modern": {
      title: "Modern web front end over an API",
      eyebrow: "Modernized template · web",
      lead: "Rebuild the screens as a modern web front end. A clean API sits in front of the data that already exists, so users get a current interface and the database stays as it is for now.",
      summary: "Rebuild the screens as a modern web front end, with a clean API in front of the existing data.",
      fits: "Cutover recommends this when the findings show legacy page code, such as Classic ASP, JSP or ASP.NET Web Forms, with screens and endpoints the users reach directly.",
      tags: ["Legacy pages", "Screens found", "Endpoints exposed"],
      steps: [
        ["Map the screens.", "Use the screen names and the page flow from the review to list every screen, and agree which ones matter most."],
        ["Stand up the API.", "Put the business rules that live in the pages behind endpoints that return data, not HTML."],
        ["Build the new front end", "one screen group at a time, starting with the simplest group, and run it beside the old pages."],
        ["Move users across", "group by group, and retire each old page once its replacement has been used in production."]
      ],
      stays: ["The database and its data", "Existing login and roles", "Stored procedures, until the services take them over"],
      changes: ["Every page is rebuilt as a screen in the new front end", "Logic moves from pages into the API", "Deployment moves to a modern pipeline"],
      risks: ["Logic hidden in page code may be missed. Check each screen against its findings.", "Two front ends run side by side for a time. Keep the navigation between them clear.", "Session and role checks must match in the API, or access may widen."],
      mock: mockWeb
    },
    "services-data": {
      title: "Services over a modern database",
      eyebrow: "Modernized template · data",
      lead: "Move the business rules out of stored procedures and into services that the team can test and deploy. The data then moves to a modern database in steps, with each step checked before the next.",
      summary: "Move business rules out of the database and into services, then move the data in steps.",
      fits: "Cutover recommends this when the findings show stored procedures, functions or views that hold logic, and code that reads and writes many tables.",
      tags: ["Stored procedures", "Views and functions", "Tables used in code"],
      steps: [
        ["List the routines.", "Use the routines and tables from the expanded findings to see what each piece of logic reads and writes."],
        ["Write the services", "for one area at a time, with tests that compare their results with the old routines."],
        ["Run both side by side", "and compare the outputs for real data before any switch."],
        ["Switch each area over", "and retire the routines it replaced."],
        ["Move the data", "to the new database last, in copies that are checked against the source."]
      ],
      stays: ["The screens and how users work", "The data itself, until the last step"],
      changes: ["Logic moves from the database into tested code", "Schema changes are kept in migrations", "The database engine can be replaced"],
      risks: ["Routines often hold rules nobody wrote down. Compare outputs on real data before retiring any routine.", "Reports and batch jobs may call routines directly. List them before the switch.", "Date, rounding and text rules differ between engines. Test them explicitly."],
      mock: mockServices
    },
    "lift-contain": {
      title: "Run as is, in containers",
      eyebrow: "Modernized template · first step",
      lead: "Package the application as it is and run it in containers. Nothing about the code or the data changes, so the risk is low, and the team gets a repeatable way to run it while the rest is modernized.",
      summary: "Run the application as it is, in containers, with its data unchanged. Modernize it later, one part at a time.",
      fits: "Cutover recommends this when the application has no infrastructure as code, has dependencies to upgrade, or the team needs a safe first step before larger changes.",
      tags: ["No infrastructure as code", "Dependencies to upgrade", "Low risk"],
      steps: [
        ["Confirm what runs.", "Use the runtime and dependency findings to choose a base image that matches the application."],
        ["Write the container definition", "and keep it in the repository, next to the code."],
        ["Move configuration out", "of the code into environment settings, so the same image runs in every place."],
        ["Run it in a test environment", "and compare its behaviour with the current one."],
        ["Move to production", "once the comparison is clean, and keep the old host for a fallback period."]
      ],
      stays: ["The code, unchanged", "The database and its data", "The screens and roles"],
      changes: ["Where the application runs", "How it is built and deployed", "Configuration moves to settings"],
      risks: ["Old components may not run on a current base image. Test each one.", "Files written to the server's disk are lost when a container restarts. Find them first.", "This moves the problem rather than solving it. Plan the next steps while it runs."],
      mock: mockContainers
    }
  };
  const ORDER = ["web-modern", "services-data", "lift-contain"];
  const FITS = { recommended: "Recommended for this application", possible: "A possible fit", weak: "A weaker fit" };

  function make(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  const box = (text, cls) => make("div", text, `box ${cls || ""}`.trim());
  const arrow = (text) => make("div", text || "↓", "arrow");

  // Drawings: each one shows the proposed design with plain boxes.
  function mockWeb() {
    const m = make("div", null, "mock");
    const top = make("div", null, "browser-top");
    for (let i = 0; i < 3; i++) top.appendChild(make("i"));
    top.appendChild(make("span", "New front end"));
    const body = make("div", null, "web-body");
    const side = make("div", null, "side");
    ["Home", "Orders", "Reports", "Settings"].forEach((n, i) => side.appendChild(make("span", n, i === 1 ? "on" : "")));
    const screens = make("div", null, "screens");
    ["Screen group 1", "Screen group 2", "Screen group 3", "Screen group 4"].forEach((n) => screens.appendChild(make("div", n)));
    body.append(side, screens);
    const wrap = make("div", null, "mock-inner");
    wrap.append(top, body);
    m.appendChild(wrap);
    m.appendChild(arrow("↓ calls the API"));
    m.appendChild(box("API: business rules, endpoints that return data", "new"));
    m.appendChild(arrow());
    m.appendChild(box("Existing database, unchanged for now", "db"));
    return m;
  }

  function mockServices() {
    const m = make("div", null, "mock");
    const row = make("div", null, "services-row");
    row.appendChild(box("Application front end", "new"));
    row.appendChild(make("div", "→", "arrow arrow-h"));
    const chips = make("div", null, "chips");
    ["Service: area 1", "Service: area 2", "Service: area 3"].forEach((n) => chips.appendChild(make("span", n)));
    row.appendChild(chips);
    row.appendChild(make("div", "→", "arrow arrow-h"));
    row.appendChild(box("New database, filled in steps", "db"));
    m.appendChild(row);
    m.appendChild(box("Stored procedures: kept until each area is switched over, then retired", "old"));
    return m;
  }

  function mockContainers() {
    const m = make("div", null, "mock containers");
    const stack = make("div", null, "stack");
    stack.appendChild(box("Users", ""));
    stack.appendChild(arrow());
    stack.appendChild(box("Container: the application, as it is", "new"));
    const chip = make("div", "Configuration from settings", "tag");
    stack.appendChild(chip);
    stack.appendChild(arrow());
    stack.appendChild(box("Existing database, unchanged", "db"));
    m.appendChild(stack);
    m.appendChild(box("Old host, kept for a fallback period", "old"));
    return m;
  }


  // The look: the portal's colours and type, shown as they would be used in the new front end.
  function lookAndFeel() {
    const wrap = make("div", null, "look");
    const swatches = make("div", null, "swatches");
    [["Primary", "#6d28d9"], ["Highlight", "#ec4899"], ["Links and focus", "#0891b2"], ["Page", "#f7f6ff"], ["Surface", "#ffffff"], ["Text", "#1d1640"]]
      .forEach(([name, hex]) => {
        const sw = make("div", null, "swatch");
        const dot = make("i");
        dot.style.background = hex;
        sw.append(dot, make("b", name), make("span", hex));
        swatches.appendChild(sw);
      });
    const type = make("div", null, "type-sample");
    type.appendChild(make("p", "Screen title", "type-h"));
    type.appendChild(make("p", "Body text reads at 16 pixels, with clear labels and generous spacing.", "type-b"));
    const buttons = make("div", null, "buttons");
    buttons.appendChild(make("button", "Primary action", "btn-primary"));
    buttons.appendChild(make("button", "Secondary", "btn-ghost"));
    const chips = make("div", null, "status-row");
    chips.appendChild(make("span", "Verified in code", "chip ok"));
    chips.appendChild(make("span", "Inferred", "chip warn"));
    chips.appendChild(make("span", "Not shown for your role", "chip muted"));
    type.append(buttons, chips);
    wrap.appendChild(make("p", "The same colours and type as the Cutover portal, so the new application feels like one product.", "look-note"));
    wrap.append(swatches, type);
    return wrap;
  }

  // The flow: from sign-in to the screens the code shows, drawn with the screen names found.
  function pageFlow(t, ctx) {
    const flow = make("div", null, "flow");
    const names = ctx.screens.length ? ctx.screens : ["Screen 1", "Screen 2", "Screen 3"];
    const nodes = ["Sign in", "Home", ...names.slice(0, 5), "Finished"];
    nodes.forEach((n, i) => {
      if (i > 0) flow.appendChild(make("span", "→", "flow-arrow"));
      flow.appendChild(make("div", n, i === 0 || i === nodes.length - 1 ? "flow-node edge" : "flow-node"));
    });
    return flow;
  }

  // A screen's kind comes from its name: a dashboard, a form, a detail page or a list. Each screen gets a layout
  // for its kind, and the variant changes with its position, so no two screens look the same.
  function kindOf(name) {
    const n = String(name).toLowerCase();
    if (/dashboard|home|overview|summary|welcome/.test(n)) return "dash";
    if (/detail|view|profile|account|settings|review|case/.test(n)) return "detail";
    if (/\bnew\b|add|create|edit|form|entry|check|register|intake|update|record|book|submit/.test(n)) return "form";
    return "list";
  }

  const SAMPLE = {
    ids: ["10482", "10477", "10469", "10455", "10449", "10437"],
    dates: ["24 Oct", "23 Oct", "22 Oct", "21 Oct", "18 Oct", "16 Oct"],
    statuses: [["Open", "ok"], ["Pending", "warn"], ["Open", "ok"], ["Closed", "muted"], ["Pending", "warn"], ["Open", "ok"]]
  };

  function el(tag, text, cls) {
    return make(tag, text, cls);
  }

  // The app shell every screen sits in: sidebar, top bar with the signed-in role, and the page.
  function shell(name, index, ctx, tpl) {
    const app = el("div", null, "hf-app");
    const side = el("div", null, "hf-side");
    const brand = el("div", null, "hf-brand");
    brand.appendChild(el("i"));
    brand.appendChild(el("b", "Application"));
    side.appendChild(brand);
    const items = (ctx.screens.length ? ctx.screens : ["Home", "Work list", "New record", "Details"]).slice(0, 5);
    items.forEach((n) => side.appendChild(el("span", n, n === name ? "on" : "")));
    if (tpl === "services-data") side.appendChild(el("span", "Services status", "svc"));
    const main = el("div", null, "hf-main");
    const top = el("div", null, "hf-top");
    const crumb = el("div");
    crumb.appendChild(el("small", "Home / " + name));
    crumb.appendChild(el("h4", name));
    top.appendChild(crumb);
    const role = ctx.roles.length ? ctx.roles[index % ctx.roles.length] : "Signed in";
    top.appendChild(el("span", role, "hf-role"));
    if (tpl === "lift-contain") top.appendChild(el("span", "Running in a container", "hf-badge"));
    if (tpl === "services-data") top.appendChild(el("span", "Calls services", "hf-badge"));
    main.appendChild(top);
    app.append(side, main);
    return { app, main };
  }

  function listBody(index, variant) {
    const wrap = el("div", null, "hf-body");
    const bar = el("div", null, "hf-toolbar");
    bar.appendChild(el("span", "Search records", "hf-input"));
    bar.appendChild(el("span", "Status: Open", "hf-filter"));
    bar.appendChild(el("span", variant % 2 ? "Owner: Any" : "Last 30 days", "hf-filter"));
    bar.appendChild(el("span", "New", "hf-btn"));
    wrap.appendChild(bar);
    if (variant % 2 === 1) {
      // Every second list reads as cards, so it does not look like the first.
      const cards = el("div", null, "hf-cards");
      for (let i = 0; i < 4; i++) {
        const [label, tone] = SAMPLE.statuses[(i + index) % SAMPLE.statuses.length];
        const card = el("div", null, "hf-card-item");
        card.appendChild(el("i", ["RR", "AR", "FV", "DC"][(i + index) % 4], "hf-avatar"));
        const text = el("div");
        text.appendChild(el("b", ["Routine review", "Access request", "Follow-up visit", "Data correction"][(i + index) % 4]));
        text.appendChild(el("small", `#${SAMPLE.ids[(i + index) % SAMPLE.ids.length]} · updated ${SAMPLE.dates[(i + index) % SAMPLE.dates.length]}`));
        card.append(text, el("span", label, "hf-chip " + tone));
        cards.appendChild(card);
      }
      wrap.appendChild(cards);
      const foot = el("div", null, "hf-foot");
      foot.appendChild(el("span", "4 of 128 shown"));
      foot.appendChild(el("span", "Load more"));
      wrap.appendChild(foot);
      return wrap;
    }
    const table = el("div", null, "hf-table");
    const head = el("div", null, "hf-row head");
    ["Reference", "Subject", "Updated", "Status"].forEach((h) => head.appendChild(el("span", h)));
    table.appendChild(head);
    for (let i = 0; i < 5; i++) {
      const row = el("div", null, "hf-row");
      const [label, tone] = SAMPLE.statuses[(i + index) % SAMPLE.statuses.length];
      row.appendChild(el("span", "#" + SAMPLE.ids[(i + index) % SAMPLE.ids.length]));
      row.appendChild(el("span", ["Routine review", "Access request", "Follow-up visit", "Data correction", "Monthly check"][(i + index) % 5]));
      row.appendChild(el("span", SAMPLE.dates[(i + index) % SAMPLE.dates.length]));
      row.appendChild(el("span", label, "hf-chip " + tone));
      table.appendChild(row);
    }
    wrap.appendChild(table);
    const foot = el("div", null, "hf-foot");
    foot.appendChild(el("span", "1 to 5 of 128"));
    foot.appendChild(el("span", "Previous  ·  Next"));
    wrap.appendChild(foot);
    return wrap;
  }

  function formBody(index) {
    const wrap = el("div", null, "hf-body hf-form");
    const fields = el("div", null, "hf-fields");
    [["Reference", "Generated on save"], ["Requested by", "Name of the person"], ["Date needed", "24 Oct 2026"], ["Priority", "Normal"]]
      .forEach(([label, value]) => {
        const f = el("label", null, "hf-field");
        f.appendChild(el("span", label));
        f.appendChild(el("i", value));
        fields.appendChild(f);
      });
    const note = el("label", null, "hf-field wide");
    note.appendChild(el("span", "Notes"));
    note.appendChild(el("i", "Describe what is needed and any deadline."));
    fields.appendChild(note);
    wrap.appendChild(fields);
    const side = el("div", null, "hf-panel");
    side.appendChild(el("b", "Checklist"));
    ["Details complete", "Owner confirmed", "Sent for review"].forEach((t, i) => {
      const row = el("div", null, "hf-check " + (i < 2 ? "done" : ""));
      row.appendChild(el("i"));
      row.appendChild(el("span", t));
      side.appendChild(row);
    });
    const bar = el("div", null, "hf-progress");
    const fill = el("i");
    fill.style.width = `${index % 2 ? 66 : 40}%`;
    bar.appendChild(fill);
    side.appendChild(bar);
    wrap.appendChild(side);
    const actions = el("div", null, "hf-actions wide");
    actions.appendChild(el("span", "Cancel", "hf-btn ghost"));
    actions.appendChild(el("span", "Save and continue", "hf-btn"));
    wrap.appendChild(actions);
    return wrap;
  }

  function dashBody(index) {
    const wrap = el("div", null, "hf-body");
    const kpis = el("div", null, "hf-kpis");
    [["Open items", "142", "+8 this week"], ["Waiting on others", "37", "5 overdue"], ["Closed this month", "611", "+12%"]].forEach(([l, v, d], i) => {
      const k = el("div", null, "hf-kpi");
      k.appendChild(el("small", l));
      k.appendChild(el("b", v));
      k.appendChild(el("span", d, i === 1 ? "warn" : "ok"));
      kpis.appendChild(k);
    });
    wrap.appendChild(kpis);
    const chart = el("div", null, "hf-chart");
    const heights = index % 2 ? [40, 58, 46, 72, 64, 80, 55] : [70, 52, 66, 38, 60, 48, 74];
    heights.forEach((h, i) => {
      const col = el("i");
      col.style.height = h + "%";
      col.title = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i];
      chart.appendChild(col);
    });
    const card = el("div", null, "hf-panel");
    card.appendChild(el("b", "Volume this week"));
    card.appendChild(chart);
    wrap.appendChild(card);
    const recent = el("div", null, "hf-panel");
    recent.appendChild(el("b", "Recent activity"));
    ["Record #10482 updated", "Access request approved", "Follow-up scheduled"].forEach((t, i) => {
      const r = el("div", null, "hf-check");
      r.appendChild(el("i"));
      r.appendChild(el("span", t + " · " + ["2 h ago", "Yesterday", "3 days ago"][i]));
      recent.appendChild(r);
    });
    wrap.appendChild(recent);
    return wrap;
  }

  function detailBody(index) {
    const wrap = el("div", null, "hf-body hf-detail");
    const head = el("div", null, "hf-detail-head");
    head.appendChild(el("b", "Record #" + SAMPLE.ids[index % SAMPLE.ids.length]));
    head.appendChild(el("span", index % 2 ? "Pending" : "Open", "hf-chip " + (index % 2 ? "warn" : "ok")));
    wrap.appendChild(head);
    const kv = el("div", null, "hf-panel");
    [["Owner", "Team lead"], ["Created", "16 Oct"], ["Last change", "24 Oct"], ["Priority", "Normal"]].forEach(([k, v]) => {
      const row = el("div", null, "hf-kv");
      row.appendChild(el("span", k));
      row.appendChild(el("i", v));
      kv.appendChild(row);
    });
    wrap.appendChild(kv);
    const timeline = el("div", null, "hf-panel");
    timeline.appendChild(el("b", "History"));
    ["Reviewed by owner", "Updated details", "Created"].forEach((t, i) => {
      const r = el("div", null, "hf-check done");
      r.appendChild(el("i"));
      r.appendChild(el("span", t));
      timeline.appendChild(r);
    });
    wrap.appendChild(timeline);
    const actions = el("div", null, "hf-actions wide");
    actions.appendChild(el("span", "Back", "hf-btn ghost"));
    actions.appendChild(el("span", "Mark complete", "hf-btn"));
    wrap.appendChild(actions);
    return wrap;
  }

  // One full screen, drawn in the app shell, with content for its kind.
  function highFidelity(name, index, ctx, tpl, variant) {
    const frame = el("figure", null, "hf");
    const { app, main } = shell(name, index, ctx, tpl);
    const kind = kindOf(name);
    main.appendChild(kind === "dash" ? dashBody(index) : kind === "form" ? formBody(index) : kind === "detail" ? detailBody(index) : listBody(index, variant));
    frame.appendChild(app);
    const cap = el("figcaption", `${name}: ${kind === "dash" ? "dashboard" : kind === "form" ? "form" : kind === "detail" ? "detail page" : "list"}, screen ${index + 1}`);
    frame.appendChild(cap);
    return frame;
  }

  function wireframes(ctx, caption, tpl) {
    const block = el("div");
    block.appendChild(el("p", caption, "look-note"));
    const wrap = el("div", null, "hf-grid");
    const fallback = ["Home dashboard", "Work list", "New record", "Record details"];
    const names = ctx.screens.length ? ctx.screens : fallback;
    let lists = 0;
    names.slice(0, 4).forEach((n, i) => {
      const variant = kindOf(n) === "list" ? lists++ : i;
      wrap.appendChild(highFidelity(n, i, ctx, tpl, variant));
    });
    block.appendChild(wrap);
    block.appendChild(el("p", ctx.screens.length
      ? `Drawn from ${ctx.screenCount} screen ${ctx.screenCount === 1 ? "name" : "names"} the code shows. Labels and values are examples, not your data.`
      : "No screen names were found, so these are examples of the kinds of screen the application is likely to need. Labels and values are examples.", "look-note"));
    return block;
  }

  // What the page is built on: the evidence the review found.
  function evidence(ctx) {
    const items = [];
    if (ctx.screenCount) items.push(`${ctx.screenCount} screens named in the code`);
    if (ctx.tables) items.push(`${ctx.tables} tables used in SQL`);
    if (ctx.languages.length) items.push(`Languages: ${ctx.languages.join(", ")}`);
    if (ctx.roles.length) items.push(`Roles: ${ctx.roles.join(", ")}`);
    return items;
  }

  function section(title) {
    const h = make("h2", title);
    return h;
  }
  function card(children) {
    const c = make("div", null, "card");
    children.forEach((n) => c.appendChild(n));
    return c;
  }
  function list(items) {
    const ul = make("ul");
    items.forEach((t) => ul.appendChild(make("li", t)));
    return ul;
  }

  function render(id, fit, rec, ctx, analysis) {
    const t = T[id];
    const app = document.getElementById("app");
    app.textContent = "";
    const wrap = make("div", null, "wrap");
    wrap.appendChild(backLink("← Back to the assessment", "back"));
    const actionsTop = make("div", null, "choose-row");
    if (analysis) actionsTop.appendChild(chooseButton(id, analysis));
    if (analysis) wrap.appendChild(actionsTop);

    const hero = make("section", null, "hero");
    hero.appendChild(make("p", t.eyebrow, "eyebrow"));
    hero.appendChild(make("h1", t.title));
    hero.appendChild(make("p", t.lead, "lead"));
    const label = fit && FITS[fit] ? FITS[fit] : "Preview";
    hero.appendChild(make("span", label, fit === "recommended" ? "fit rec" : "fit"));
    wrap.appendChild(hero);

    const found = evidence(ctx);
    if (found.length) {
      const basis = make("div", null, "basis");
      basis.appendChild(make("p", "Built on what Cutover found in the code", "proposal-title"));
      const row = make("div");
      found.forEach((f) => row.appendChild(make("span", f, "tag")));
      basis.appendChild(row);
      wrap.appendChild(basis);
    }

    wrap.appendChild(section("What we are proposing"));
    const proposal = make("div", null, "proposal");
    proposal.appendChild(make("p", "The target design, in outline", "proposal-title"));
    proposal.appendChild(t.mock());
    wrap.appendChild(proposal);

    // Run as is, in containers changes no code, so the look, the page flow and the screen layouts do not apply.
    // The look changes only when the screens are rebuilt, so only the web front end shows it.
    if (id === "web-modern") {
      wrap.appendChild(section("How it could look"));
      const look = make("div", null, "proposal");
      look.appendChild(make("p", "Look and feel", "proposal-title"));
      look.appendChild(lookAndFeel());
      wrap.appendChild(look);
    }
    if (id !== "lift-contain") {
      wrap.appendChild(section("Page flow"));
      const flowCard = make("div", null, "proposal");
      flowCard.appendChild(make("p", "From sign-in to the finished task", "proposal-title"));
      flowCard.appendChild(pageFlow(t, ctx));
      flowCard.appendChild(make("p", ctx.screens.length ? "Screen names come from the code. Each step is a screen the team rebuilds or keeps." : "No screen names were found, so the steps are placeholders.", "look-note"));
      wrap.appendChild(flowCard);

      wrap.appendChild(section(id === "services-data" ? "Conceptual wireframes for data flow" : "Wireframes"));
      const captions = {
        "web-modern": "Each screen is rebuilt in the new front end, with the same fields and actions.",
        "services-data": "The screens stay as they are, and call the new services behind them.",
        "lift-contain": "The screens do not change. They run in a container instead."
      };
      const frames = make("div", null, "proposal");
      frames.appendChild(make("p", "Screen layouts", "proposal-title"));
      frames.appendChild(wireframes(ctx, captions[id] || "", id));
      wrap.appendChild(frames);
    }

    wrap.appendChild(section("When it fits"));
    wrap.appendChild(card([make("p", t.fits), tagRow(t.tags)]));

    wrap.appendChild(section("How the move goes"));
    const steps = make("ol", null, "steps");
    t.steps.forEach(([bold, rest]) => {
      const li = make("li");
      const div = make("div");
      div.appendChild(make("strong", bold + " "));
      div.appendChild(document.createTextNode(rest));
      li.appendChild(div);
      steps.appendChild(li);
    });
    wrap.appendChild(steps);

    wrap.appendChild(section("What stays and what changes"));
    const two = make("div", null, "two");
    two.appendChild(card([make("strong", "Stays for now"), list(t.stays)]));
    two.appendChild(card([make("strong", "Changes"), list(t.changes)]));
    wrap.appendChild(two);

    wrap.appendChild(section("Main risks"));
    wrap.appendChild(card([list(t.risks)]));
    wrap.appendChild(make("p", "This is a template, not a plan for one application. Cutover shows where each finding is in the code, and the team decides the order.", "note"));
    const footer = make("div", null, "preview-foot");
    footer.appendChild(backLink("← Back to the assessment", "back-btn"));
    if (analysis) footer.appendChild(chooseButton(id, analysis));
    wrap.appendChild(footer);

    // The other two options, behind the proposal, for comparison.
    const others = make("section", null, "others");
    others.appendChild(make("h2", "Other options, for comparison"));
    const grid = make("div", null, "others-grid");
    ORDER.filter((o) => o !== id).forEach((o) => {
      const alt = T[o];
      const altCard = make("div", null, "alt");
      if (o === rec) altCard.appendChild(make("span", "Recommended for this application", "fit rec"));
      altCard.appendChild(make("h3", alt.title));
      altCard.appendChild(make("p", alt.summary));
      altCard.appendChild(alt.mock());
      const link = make("a", "Open this preview →");
      link.href = `${o}.html?fit=${o === rec ? "recommended" : "possible"}&rec=${rec || ""}`;
      altCard.appendChild(link);
      grid.appendChild(altCard);
    });
    others.appendChild(grid);
    wrap.appendChild(others);
    app.appendChild(wrap);
  }

  // Returns to the screen the reader came from, which is the assessment's review. If the page was opened
  // directly, the link goes to the portal instead.
  function cameFromPortal() {
    try { return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin && window.history.length > 1; } catch (err) { return false; }
  }

  function backLink(text, cls) {
    const link = make("a", text, cls);
    link.href = "../index.html";
    link.addEventListener("click", (e) => {
      if (cameFromPortal()) {
        e.preventDefault();
        window.history.back();
      }
    });
    return link;
  }

  // Chooses this template for the analysis. The review saves it when it opens again, so the choice is made there.
  function chooseButton(id, analysis) {
    const btn = make("button", "Choose this approach", "choose-btn");
    btn.type = "button";
    btn.addEventListener("click", () => {
      try {
        sessionStorage.setItem("cutover.pendingTemplate", JSON.stringify({ template: id, analysis: analysis, at: Date.now() }));
      } catch (err) { /* storage may be blocked; the choice then has to be made on the review */ }
      if (cameFromPortal()) window.history.back();
      else window.location.href = "../index.html";
    });
    return btn;
  }

  function tagRow(tags) {
    const row = make("div");
    tags.forEach((t) => row.appendChild(make("span", t, "tag")));
    return row;
  }

  // The evidence from the review: screen names, languages, roles and table count. Empty if it is missing or damaged.
  function readContext(raw) {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(raw))));
      const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : []);
      return {
        screens: strings(data.screens),
        screenCount: Number(data.screenCount) || 0,
        languages: strings(data.languages),
        roles: strings(data.roles),
        tables: Number(data.tables) || 0,
      };
    } catch (e) {
      return { screens: [], screenCount: 0, languages: [], roles: [], tables: 0 };
    }
  }

  const app = document.getElementById("app");
  const id = app && T[app.dataset.template] ? app.dataset.template : "web-modern";
  const params = new URLSearchParams(window.location.search);
  const fit = ["recommended", "possible", "weak"].includes(params.get("fit")) ? params.get("fit") : "";
  const rec = ORDER.includes(params.get("rec")) ? params.get("rec") : "";
  const ctx = readContext(params.get("ctx") || "");
  const analysis = /^[0-9a-f-]{36}$/i.test(params.get("analysis") || "") ? params.get("analysis") : "";
  render(id, fit, rec, ctx, analysis);
})();
