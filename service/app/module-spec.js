// The module spec for one approved feature: its stories, rules, functions, data, worked examples as acceptance tests,
// and how well each file is supported. Plain Markdown, with no agent or model named. Pure, so the tests can run it.
(function (root) {
  const WORD = { high: "High", medium: "Medium", low: "Low" };
  const band = (score) => (score >= 80 ? "high" : score >= 55 ? "medium" : "low");
  const where = (lines) => (Array.isArray(lines) ? ` (lines ${lines[0]}–${lines[1]})` : "");
  // Words that tie a rule to the date the code runs. Such a rule is a question to answer before it is built.
  const DATE_WORDS = /\btoday\b|\bcurrent (system )?date\b|\bsystem date\b|\bmodified\b|\bdate\b/i;
  const keyOf = (r) => `${r.file} · ${r.id}`;
  const slug = (text) => String(text || "feature").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "feature";

  // feature: one approved feature from the features endpoint. ctx: { app, approvedBy, approvedAt, confidenceOf }.
  function build(feature, ctx) {
    const out = [];
    const files = feature.files || [];
    const assessed = files.filter((f) => f.assessment);
    const scores = assessed.map((f) => ctx.confidenceOf({ functions: f.assessment.functions, rules: f.assessment.rules, examples: f.assessment.examples }, f.assessment.dropped).score);
    // Every feature in the grouping, so a rule that several features cite is found.
    const all = Array.isArray(ctx.allFeatures) && ctx.allFeatures.length ? ctx.allFeatures : [feature];
    const citedBy = new Map();
    for (const other of all) {
      for (const st of other.stories || []) {
        for (const r of st.rules || []) {
          if (!citedBy.has(keyOf(r))) citedBy.set(keyOf(r), new Set());
          citedBy.get(keyOf(r)).add(other.name);
        }
      }
    }
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    out.push(`# Module: ${feature.name}`, "");
    out.push(`Application: ${ctx.app || "(unnamed)"}`);
    out.push(`Approved by: ${ctx.approvedBy || "the application owner"}${ctx.approvedAt ? ` on ${String(ctx.approvedAt).slice(0, 10)}` : ""}`);
    out.push(`Confidence: ${avg === null ? "no approved assessment yet" : `${WORD[band(avg)]} (${avg})`}`, "");
    out.push("Sample data only. Values in this spec are placeholders, not real data.", "");
    if (feature.summary) out.push("## Purpose", "", feature.summary, "");

    out.push("## User stories", "");
    if (!(feature.stories || []).length) out.push("No user stories drafted for this feature yet.", "");
    for (const st of feature.stories || []) {
      out.push(`- ${st.story}`);
      for (const r of st.rules || []) out.push(`  - Rule ${r.id} in ${r.file}${where(r.lines)}${r.current ? "" : " (no longer in the approved assessment)"}`);
    }
    out.push("");

    out.push("## Files", "");
    if (!files.length) out.push("No files in this feature.", "");
    files.forEach((f, i) => {
      if (!f.assessment) {
        out.push(`- ${f.path}: no approved assessment yet`);
        return;
      }
      out.push(`- ${f.path}: ${WORD[band(scores[assessed.indexOf(f)])]} confidence (${scores[assessed.indexOf(f)]})${f.purpose ? ` — ${f.purpose}` : ""}`);
    });
    out.push("");

    out.push("## Rules", "");
    let anyRule = false;
    for (const f of assessed) {
      for (const r of f.assessment.rules || []) {
        anyRule = true;
        out.push(`### ${f.path} · ${r.id}`, "");
        out.push(r.statement || "(no statement)", "");
        if (r.condition) out.push(`- When: ${r.condition}`);
        if (r.outcome) out.push(`- Then: ${r.outcome}`);
        if (r.function) out.push(`- Function: ${r.function}`);
        if (Array.isArray(r.lines)) out.push(`- Source lines: ${r.lines[0]}–${r.lines[1]} in ${f.path}`);
        out.push("");
      }
    }
    if (!anyRule) out.push("No rules in the approved assessments of this feature.", "");

    out.push("## Functions", "");
    let anyFn = false;
    for (const f of assessed) {
      for (const fn of f.assessment.functions || []) {
        anyFn = true;
        out.push(`- ${fn.name} (${f.path})${fn.purpose ? `: ${fn.purpose}` : ""}${fn.calls && fn.calls.length ? ` — calls ${fn.calls.join(", ")}` : ""}`);
      }
    }
    if (!anyFn) out.push("No functions in the approved assessments of this feature.");
    out.push("");

    out.push("## Data", "");
    let anyData = false;
    for (const f of assessed) {
      const db = f.assessment.database || { tables: [], queries: [] };
      for (const t of db.tables || []) {
        anyData = true;
        out.push(`- Table ${t.name} (${f.path})${t.operations && t.operations.length ? `: ${t.operations.join(", ")}` : ""}${t.fields && t.fields.length ? `; fields ${t.fields.join(", ")}` : ""}`);
      }
      for (const q of db.queries || []) {
        anyData = true;
        out.push(`- ${q.operation}${q.function ? ` in ${q.function}` : ""} on ${(q.tables || []).join(", ") || "(no table named)"} (${f.path})`);
      }
    }
    if (!anyData) out.push("No data read or written in the approved assessments of this feature.");
    out.push("");

    out.push("## Shared rules", "");
    const mine = [...new Set((feature.stories || []).flatMap((st) => (st.rules || []).map(keyOf)))];
    const sharedRules = mine.filter((k) => citedBy.has(k) && citedBy.get(k).size > 1);
    if (!sharedRules.length) out.push("No rule is shared with another feature.");
    for (const k of sharedRules) {
      const others = [...citedBy.get(k)].filter((n) => n !== feature.name);
      out.push(`- ${k} is also used by ${others.join(", ")}. Keep one copy; the other module refers to it.`);
    }
    out.push("");

    out.push("## Acceptance tests", "");
    let anyExample = false;
    for (const f of assessed) {
      for (const e of f.assessment.examples || []) {
        if (!e.given && !e.expect) continue;
        anyExample = true;
        out.push(`- Rule ${e.rule} (${f.path})`);
        out.push(`  - Given: ${e.given || "(not given)"}`);
        out.push(`  - Expect: ${e.expect || "(not given)"}`);
      }
    }
    if (!anyExample) out.push("No worked examples in the approved assessments of this feature.");
    out.push("");

    // Open questions: what must be answered before the module is built.
    const questions = [];
    for (const f of assessed) {
      const examples = f.assessment.examples || [];
      for (const r of f.assessment.rules || []) {
        const text = [r.statement, r.condition, r.outcome].filter(Boolean).join(" ");
        if (DATE_WORDS.test(text)) {
          questions.push(`Confirm ${r.id} in ${f.path}: it depends on the date the code runs. Is that a business requirement, or a leftover from the old system?`);
        }
        if (!examples.some((e) => e.rule === r.id)) {
          questions.push(`Add an acceptance test for ${r.id} in ${f.path}. None of the worked examples covers it.`);
        }
      }
    }
    for (const f of files) {
      if (!f.assessment) questions.push(`${f.path} has no approved assessment, so what it does is not yet known.`);
    }
    out.push("## Open questions", "");
    if (!questions.length) out.push("No open questions for this feature.");
    for (const q of questions) out.push(`- ${q}`);
    out.push("");

    out.push("## Decisions before building", "");
    out.push(ctx.targetLanguage
      ? `- Target language: ${ctx.targetLanguage}${ctx.targetChosenBy ? ` (chosen by ${ctx.targetChosenBy})` : ""}`
      : "- Target language: not chosen yet. Decide it before building.");
    if (ctx.approach) out.push(`- Approach: ${ctx.approach}`);
    const reads = assessed.some((f) => ((f.assessment.database || {}).tables || []).length || ((f.assessment.database || {}).queries || []).length);
    if (reads) out.push("- Data: this module reads or writes data. Decide the database and where it runs before building.");
    out.push("");

    out.push("## Confidence and limits", "");
    for (const f of files) {
      if (!f.assessment) continue;
      if (f.assessment.dropped > 0) out.push(`- ${f.path}: ${f.assessment.dropped} ${f.assessment.dropped === 1 ? "name was" : "names were"} left out, not found in the code.`);
    }
    out.push("- Confidence is a check of names, line numbers and worked examples against the code. It is not proof that the behaviour is right.");
    out.push("");
    return { markdown: out.join("\n"), file: `module-${slug(feature.name)}.md` };
  }

  root.ModuleSpec = { build, slug };
})(typeof globalThis !== "undefined" ? globalThis : this);
