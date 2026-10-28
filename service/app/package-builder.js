// The agent package for the approved features: a manifest, a brief shared by every module, and one module file per
// approved feature. Plain text and Markdown only, with no agent or model named. Also packs the files into a zip.
(function (root) {
  const SCOPE = { deeper: "Deeper assessment", modernize: "Modernize", migrate: "Migrate" };

  // data: the features response. ctx: { app, approach, scope, targetLanguage, targetChosenBy, confidenceOf, ModuleSpec }.
  function build(data, ctx) {
    const grouping = data.grouping;
    if (!grouping) return null;
    const files = {};
    const modules = [];
    const usedNames = new Set();
    for (const f of data.features || []) {
      const spec = ctx.ModuleSpec.build(f, {
        app: ctx.app,
        approvedBy: grouping.approved_by_email,
        approvedAt: grouping.approved_at,
        confidenceOf: ctx.confidenceOf,
        allFeatures: data.features,
        targetLanguage: ctx.targetLanguage,
        targetChosenBy: ctx.targetChosenBy,
        approach: ctx.approach,
      });
      let name = spec.file;
      for (let n = 2; usedNames.has(name); n++) name = spec.file.replace(/\.md$/, `-${n}.md`);
      usedNames.add(name);
      const path = `modules/${name}`;
      files[path] = spec.markdown;
      const assessed = (f.files || []).filter((x) => x.assessment);
      modules.push({
        file: path,
        feature: f.name,
        status: "approved",
        approved_by: grouping.approved_by_email || null,
        approved_at: grouping.approved_at || null,
        version: grouping.id,
        stories: (f.stories || []).length,
        files: (f.files || []).map((x) => x.path),
        files_without_approved_assessment: (f.files || []).filter((x) => !x.assessment).map((x) => x.path),
        assessed_files: assessed.length,
      });
    }

    const approach = ctx.approach || null;
    const scope = ctx.scope ? SCOPE[ctx.scope] || ctx.scope : null;
    files["manifest.json"] = JSON.stringify({
      format: "cutover-agent-package",
      format_version: 1,
      application: ctx.app || null,
      sample_data_only: true,
      agent_neutral: true,
      approval: { approved_by: grouping.approved_by_email || null, approved_at: grouping.approved_at || null, grouping_id: grouping.id },
      scope,
      approach,
      target_language: ctx.targetLanguage || null,
      target_language_chosen_by: ctx.targetChosenBy || null,
      modules,
    }, null, 2) + "\n";

    const lines = [];
    lines.push(`# Build brief: ${ctx.app || "the application"}`, "");
    lines.push("This brief applies to every module in this package. Read it before any module.", "");
    lines.push("## What is being built", "");
    lines.push(`- Application: ${ctx.app || "(unnamed)"}`);
    lines.push(`- Scope: ${scope || "not chosen yet"}`);
    lines.push(`- Approach: ${approach || "not chosen yet"}`);
    lines.push(`- Target language: ${ctx.targetLanguage || "not chosen yet"}${ctx.targetLanguage && ctx.targetChosenBy ? ` (chosen by ${ctx.targetChosenBy})` : ""}`);
    lines.push(`- Approved modules: ${modules.length}. Only the modules listed in manifest.json are in scope.`, "");
    lines.push("## Rules for every module", "");
    lines.push("- Use sample data only. Never write real names, contact details, identifiers or health information into the new system, its fixtures or its tests.");
    lines.push("- Keep traceability. Each rule you build keeps a note of the source file, function and line range it came from, as the module lists them.");
    lines.push("- Do not copy source code. Rebuild each rule from its statement, condition, outcome and worked examples.");
    lines.push("- Each module's acceptance tests come from its worked examples. The new system must pass them before the module is done.");
    lines.push("- Where a module says a file has no approved assessment, or names a confidence below High, check that behaviour with the application owner before relying on it.");
    lines.push("- Write business language for the user-facing parts and engineering detail for the internal parts.");
    lines.push("- Build one module at a time, in the order listed in manifest.json, and report which modules pass.", "");
    lines.push("## How to use this package", "");
    lines.push("1. Read manifest.json for the approved modules and their status.");
    lines.push("2. Read this brief.");
    lines.push("3. For each module, read its file in modules/ and build it against the brief's rules.");
    lines.push("4. Do not add a module that is not listed in the manifest.", "");
    files["brief.md"] = lines.join("\n");
    return { files, file: `cutover-package-${slug(ctx.app)}.zip` };
  }

  function slug(text) {
    return String(text || "application").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "application";
  }

  // Store-only zip (no compression) with CRC-32. Returns a Uint8Array.
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
  function utf8(text) {
    const out = [];
    for (const ch of String(text)) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }
  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const DOS_DATE = (1 << 5) | 1; // 1980-01-01, fixed so the same input gives the same bytes
    for (const [name, text] of Object.entries(files)) {
      const nameBytes = utf8(name);
      const data = utf8(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true);
      local.setUint16(10, 0, true);
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, 0x02014b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 20, true);
      head.setUint16(8, 0x0800, true);
      head.setUint16(10, 0, true);
      head.setUint16(12, 0, true);
      head.setUint16(14, DOS_DATE, true);
      head.setUint32(16, crc, true);
      head.setUint32(20, data.length, true);
      head.setUint32(24, data.length, true);
      head.setUint16(28, nameBytes.length, true);
      head.setUint32(42, offset, true);
      central.push(new Uint8Array(head.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const total = all.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  root.PackageBuilder = { build, zip, crc32, utf8 };
})(typeof globalThis !== "undefined" ? globalThis : this);
