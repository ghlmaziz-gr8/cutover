// Stage 2: the starter project. Files and a zip, built in the browser from the findings the viewer can already see.
// It holds structure only: folder and file names, placeholder pages, and a map from each old item to its new place.
// It contains no business logic and no value from the code. Run: node --test service/app/test/starter.test.mjs
(function (root) {
  const TITLES = {
    "web-modern": "Modern web front end over an API",
    "services-data": "Services over a modern database",
    "lift-contain": "Run as is, in containers",
  };

  function slug(text, fallback) {
    const s = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || fallback;
  }

  // Unique slugs: a second "Work list" becomes "work-list-2".
  function uniqueSlugs(names, fallback) {
    const seen = {};
    return names.map((name, i) => {
      const base = slug(name, `${fallback}-${i + 1}`);
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] === 1 ? base : `${base}-${seen[base]}`;
    });
  }

  // A name that looks like a person's data (an email, a phone number, a long number) is never written into the starter.
  const LOOKS_LIKE_DATA = /@|\d{3}[-. ]\d{4}|\d{5,}/;

  // The names in a finding, whether it holds names, objects with a name, or only a count.
  function namesOf(item) {
    const v = item && item.value;
    let names = [];
    if (Array.isArray(v)) {
      names = v.map((x) => (typeof x === "string" ? x : x && (x.name || x.title || x.path) ? String(x.name || x.title || x.path) : null)).filter(Boolean);
    } else if (typeof v === "string" && v.trim()) {
      names = [v.trim()];
    }
    return names.filter((n) => !LOOKS_LIKE_DATA.test(n));
  }

  function countOf(item) {
    const v = item && item.value;
    if (Array.isArray(v)) return v.length;
    if (typeof v === "number") return v;
    return v ? 1 : 0;
  }

  function readme(input) {
    return [
      `# Starter project: ${input.appName || input.repo || "the application"}`,
      "",
      `Approach: ${TITLES[input.template] || input.template}`,
      `Created: ${input.generatedAt || "not recorded"}`,
      "",
      "This is a starter, not working code. It has the folders, the placeholder pages and the map from the old application.",
      "It contains no business logic from the application, and no value from its code. Sample data only.",
      "",
      "The old application stays where it is until each part is rebuilt and checked. See MAPPING.md for where each item goes.",
      "",
      "Secrets and connection details are never stored in this project. Set them in your secret store.",
      "",
    ].join("\n");
  }

  function mapping(rows) {
    const out = ["# Mapping from the old application", "", "| Old item | Kind | New location | Status |", "| --- | --- | --- | --- |"];
    for (const r of rows) out.push(`| ${r.old} | ${r.kind} | ${r.location} | Not started |`);
    if (!rows.length) out.push("| None found in the review | | | |");
    out.push("");
    return out.join("\n");
  }

  // Every file in the starter, as { path, text }. Pure: the same findings always give the same files.
  function files(input) {
    const f = input.findings || {};
    const template = input.template;
    const out = [];
    const rows = [];
    const screens = namesOf(f["ui.screens"]).length ? namesOf(f["ui.screens"]) : namesOf(f["ui.screen_names"]);
    const endpoints = namesOf(f["ui.endpoints"]);
    const tables = namesOf(f["data.tables"]);
    const routines = namesOf(f["data.routines_in_code"]);
    const dependencies = namesOf(f["legacy.dependencies"]);

    out.push({ path: "README.md", text: readme(input) });

    if (template === "web-modern") {
      const screenSlugs = uniqueSlugs(screens, "screen");
      screenSlugs.forEach((s, i) => {
        rows.push({ old: screens[i], kind: "Screen", location: `web/pages/${s}.html` });
        out.push({ path: `web/pages/${s}.html`, text: `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screen ${s}</title></head>\n<body>\n<!-- TODO: rebuild this screen. Read the old screen in the review, and keep the same steps. -->\n<main><h1>Screen ${s}</h1></main>\n</body>\n</html>\n` });
      });
      const endpointSlugs = uniqueSlugs(endpoints, "endpoint");
      endpointSlugs.forEach((s, i) => {
        rows.push({ old: endpoints[i], kind: "Endpoint", location: `api/routes/${s}.md` });
        out.push({ path: `api/routes/${s}.md`, text: `# Endpoint ${s}\n\nTODO: rebuild this endpoint in the API. Keep the same inputs and outputs, and check them against the old one.\n` });
      });
      out.push({ path: "api/README.md", text: "# API\n\nOne route per file in routes/. Each route is rebuilt, then checked against the old endpoint it replaces.\n" });
      out.push({ path: "web/README.md", text: "# Web front end\n\nOne page per file in pages/. Each page is rebuilt and checked against the old screen it replaces.\n" });
    }

    if (template === "services-data") {
      const routineSlugs = uniqueSlugs(routines, "routine");
      routineSlugs.forEach((s, i) => {
        rows.push({ old: routines[i], kind: "Routine", location: `services/${s}/README.md` });
        out.push({ path: `services/${s}/README.md`, text: `# Service ${s}\n\nTODO: rebuild this group of rules as a service. The database routine stays until this service passes its checks.\n` });
      });
      const tableSlugs = uniqueSlugs(tables, "table");
      tableSlugs.forEach((s, i) => {
        rows.push({ old: tables[i], kind: "Table", location: `db/tables/${s}.md` });
        out.push({ path: `db/tables/${s}.md`, text: `# Table ${s}\n\nTODO: move this table in one step. Compare row counts and checksums with the old table before the next step.\n` });
      });
      out.push({ path: "db/README.md", text: "# Database\n\nSchema changes go in migrations/. Tables are moved one at a time, as described in tables/.\n" });
      out.push({ path: "db/migrations/.gitkeep", text: "" });
      if (!routineSlugs.length) out.push({ path: "services/README.md", text: "# Services\n\nNo stored routines were found in the code, so no services are needed yet.\n" });
    }

    if (template === "lift-contain") {
      out.push({ path: "Dockerfile", text: "# Starter. Replace the placeholder with the base image that matches the runtime found in the review.\nFROM REPLACE_WITH_BASE_IMAGE\n# TODO: copy the application and set its start command, as it runs today.\n" });
      out.push({ path: "compose.yaml", text: "# Starter. Add the services the application needs when they are known.\nservices: {}\n" });
      out.push({ path: "infra/README.md", text: "# Infrastructure\n\nPlaceholder. The infrastructure as code is drafted in a later step, once the target cloud and its intake are complete.\n" });
      const depSlugs = uniqueSlugs(dependencies, "dependency");
      dependencies.forEach((name, i) => {
        rows.push({ old: name, kind: "Dependency", location: `DEPENDENCIES.md (item ${depSlugs[i]})` });
      });
      const lines = ["# Dependencies to upgrade", "", "Each one is upgraded on its own, with tests after each upgrade.", ""];
      dependencies.forEach((name) => lines.push(`- ${name}: upgrade to a supported version`));
      if (!dependencies.length) lines.push("No dependencies were listed in the review.");
      lines.push("");
      out.push({ path: "DEPENDENCIES.md", text: lines.join("\n") });
    }

    out.push({ path: "MAPPING.md", text: mapping(rows) });
    return out;
  }

  // CRC-32, needed by the zip format.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // A zip with stored (uncompressed) entries, names in UTF-8, dates fixed at 1980-01-01 so the output is repeatable.
  function zip(entries) {
    const enc = new TextEncoder();
    const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
    const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const DOS_DATE = [0x21, 0x00];
    const UTF8_FLAG = [0x00, 0x08];
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
      const name = enc.encode(entry.path);
      const data = enc.encode(entry.text || "");
      const crc = crc32(data);
      const local = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, ...u16(20), ...UTF8_FLAG, ...u16(0), ...u16(0), ...DOS_DATE,
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ]);
      locals.push(local, name, data);
      const central = new Uint8Array([
        0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...UTF8_FLAG, ...u16(0), ...u16(0), ...DOS_DATE,
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]);
      centrals.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralSize = centrals.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
      ...u32(centralSize), ...u32(offset), ...u16(0),
    ]);
    const parts = [...locals, ...centrals, end];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  root.Starter = { files, zip, crc32, slug, TITLES };
})(typeof globalThis !== "undefined" ? globalThis : this);
