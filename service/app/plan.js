// Stage 1: the modernization plan. Built in the browser from the findings the viewer can already see.
// It names structures and counts only; no value from the code is copied into the plan.
// Run: node --test service/app/test/plan.test.mjs
(function (root) {
  const PHASES = {
    "web-modern": [
      { title: "Put a clean API in front of the existing data", size: "Small", detail: "Expose the current data and rules through one API, without changing the screens yet." },
      { title: "Rebuild the screens one area at a time", size: "Large", detail: "Build the new front end for one area of the application, then the next. Each area is checked against the old screens." },
      { title: "Switch users over, one area at a time", size: "Medium", detail: "Move each area's users to the new screens once its checks pass. The old pages stay available until then." },
      { title: "Retire the old pages", size: "Small", detail: "Remove the old pages after every area has been switched and checked." },
    ],
    "services-data": [
      { title: "Inventory the stored logic and tables", size: "Small", detail: "List every routine, view and table the application uses, and who relies on each one." },
      { title: "Move the business rules into services, one group at a time", size: "Large", detail: "Rebuild each group of rules as a service that can be tested and deployed. The database routine stays until its replacement passes its checks." },
      { title: "Move the data in steps, with checks after each step", size: "Large", detail: "Copy each set of tables to the new database, then compare row counts and checksums before the next step." },
      { title: "Retire the stored routines", size: "Small", detail: "Remove each routine once its service is live and its data has been checked." },
    ],
    "lift-contain": [
      { title: "Run the application as it is, in containers", size: "Medium", detail: "Package the application and run it unchanged. The data stays where it is." },
      { title: "Upgrade the listed dependencies", size: "Medium", detail: "Bring each listed dependency up to a supported version, one at a time, with tests after each upgrade." },
      { title: "Describe the infrastructure as code", size: "Medium", detail: "Record the hosting setup as code so it can be rebuilt and reviewed." },
      { title: "Modernize later, one part at a time", size: "Large", detail: "Choose the next part to change from the findings, and plan it as its own piece of work." },
    ],
  };

  const TITLES = {
    "web-modern": "Modern web front end over an API",
    "services-data": "Services over a modern database",
    "lift-contain": "Run as is, in containers",
  };

  function count(item) {
    const v = item && item.value;
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
    if (typeof v === "number") return v;
    return v ? 1 : 0;
  }

  function names(item) {
    const v = item && item.value;
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(", ");
    if (typeof v === "string") return v;
    return "";
  }

  // Small, medium or large, from the number of screens and tables found.
  function sizeOf(screens, tables) {
    const total = screens + tables;
    if (total <= 15) return "Small";
    if (total <= 60) return "Medium";
    return "Large";
  }

  function line(text) { return `- ${text}`; }

  // Builds the plan as Markdown. Everything comes from structure and counts, so no sample value can leak into it.
  function build(input) {
    const f = input.findings || {};
    const template = input.template;
    const phases = PHASES[template] || [];
    const screens = count(f["ui.screens"]) || count(f["ui.screen_names"]);
    const tables = count(f["data.tables"]);
    const routines = count(f["data.routines_in_code"]);
    const endpoints = count(f["ui.endpoints"]);
    const roles = count(f["ui.roles"]);
    const languages = names(f["stack.languages"]) || names(f["legacy.languages"]);
    const dependencies = count(f["legacy.dependencies"]);
    const hasIac = Boolean(f["infrastructure.as_code"] && f["infrastructure.as_code"].value);
    const risks = Object.values(f).filter((i) => i && i.point !== false && i.severity === "high");
    const gaps = Object.values(f).filter((i) => i && i.point !== false && i.severity === "medium");
    const limits = (input.deeper && input.deeper.limits) || [];
    const size = sizeOf(screens, tables);

    const out = [];
    out.push(`# Modernization plan: ${input.appName || input.repo || "the application"}`);
    out.push("");
    out.push(`Repository: ${input.repo || "not known"}`);
    out.push(`Approach: ${TITLES[template] || template}`);
    out.push(`Chosen by: ${input.chosenBy || "not recorded"}${input.chosenAt ? ` on ${input.chosenAt}` : ""}`);
    out.push(`Plan created: ${input.generatedAt || "not recorded"}`);
    out.push("");
    out.push("This plan uses sample data only. It names structures and counts. It contains no values from the code.");
    out.push("");

    out.push("## What we found");
    out.push(line(`Languages: ${languages || "not detected"}`));
    out.push(line(`Screens: ${screens}`));
    out.push(line(`Tables: ${tables}`));
    out.push(line(`Stored routines in code: ${routines}`));
    out.push(line(`Endpoints: ${endpoints}`));
    out.push(line(`Roles: ${roles}`));
    out.push(line(`Dependencies to upgrade: ${dependencies}`));
    out.push(line(`Infrastructure as code: ${hasIac ? "found" : "not found"}`));
    out.push("");

    out.push("## Rough size");
    out.push(`Overall: ${size}, based on ${screens} screens and ${tables} tables.`);
    out.push("");

    out.push("## Order of work");
    phases.forEach((p, i) => {
      out.push(`${i + 1}. **${p.title}** (${p.size})`);
      out.push(`   ${p.detail}`);
    });
    out.push("");

    out.push("## Risks to settle first");
    if (risks.length) risks.forEach((r) => out.push(line(`${r.title}: decide how this is handled before the step that touches it.`)));
    else out.push(line("No high-severity risks were found in the review."));
    out.push("");

    out.push("## Gaps to check");
    if (gaps.length) gaps.forEach((g) => out.push(line(`${g.title}: confirm before relying on it.`)));
    else out.push(line("No medium-severity gaps were found."));
    limits.forEach((t) => out.push(line(`Review limit: ${t}`)));
    out.push("");
    return out.join("\n");
  }

  root.Plan = { build, PHASES, TITLES, sizeOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
