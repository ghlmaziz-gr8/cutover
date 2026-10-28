// The mind map of the approved features: application, features, files, functions, rules and data. Pure, so the tests
// can run it. Each branch carries its confidence, taken from the approved assessment of its file. A feature's
// confidence is the average of its files that have an approved assessment.
(function (root) {
  const TONE = { high: "pro", medium: "possible", low: "con" };
  const WORD = { high: "High", medium: "Medium", low: "Low" };
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

  // One file: its confidence group, with its functions, rules, data and the names left out.
  function fileNode(path, assessment, confidenceOf) {
    if (!assessment) {
      return { kind: "group", tone: "plain", icon: "•", label: `${path} · no approved assessment yet`, children: [], score: null };
    }
    const conf = confidenceOf({ functions: assessment.functions, rules: assessment.rules, examples: assessment.examples }, assessment.dropped);
    const children = [];
    for (const fn of assessment.functions || []) {
      children.push({ kind: "leaf", label: fn.purpose ? `Function ${fn.name} — ${clip(fn.purpose, 120)}` : `Function ${fn.name}` });
    }
    const worked = new Set((assessment.examples || []).map((e) => e.rule));
    for (const r of assessment.rules || []) {
      const where = r.lines ? ` (lines ${r.lines[0]}–${r.lines[1]})` : "";
      const fn = r.function ? ` · in ${r.function}` : "";
      const example = worked.has(r.id) ? " · has a worked example" : "";
      children.push({ kind: "leaf", label: `Rule ${r.id}: ${clip(r.statement || "(no statement)", 140)}${where}${fn}${example}` });
    }
    const database = assessment.database || { tables: [], queries: [] };
    for (const t of database.tables || []) {
      const ops = (t.operations || []).join(", ");
      children.push({ kind: "leaf", label: `Table ${t.name}${ops ? ` · ${ops}` : ""}` });
    }
    for (const q of database.queries || []) {
      const on = (q.tables || []).join(", ");
      children.push({ kind: "leaf", label: `${q.operation}${q.function ? ` in ${q.function}` : ""}${on ? ` on ${on}` : ""}` });
    }
    if (assessment.dropped > 0) {
      children.push({ kind: "leaf", label: `${assessment.dropped} ${assessment.dropped === 1 ? "name" : "names"} left out, not found in the code` });
    }
    return {
      kind: "group",
      tone: TONE[conf.band],
      icon: "◆",
      label: `${path} · ${WORD[conf.band]} confidence ${conf.score}`,
      children,
      score: conf.score,
    };
  }

  // The whole map. Returns null when there is no approved feature grouping, so the card can stay hidden.
  function build(data, confidenceOf, appName) {
    if (!data || !data.grouping || !Array.isArray(data.features) || !data.features.length) return null;
    const features = data.features.map((f) => {
      const files = (f.files || []).map((file) => ({ path: file.path, node: fileNode(file.path, file.assessment, confidenceOf) }));
      const scored = files.map((x) => x.node.score).filter((s) => s !== null);
      const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
      const band = avg === null ? null : avg >= 80 ? "high" : avg >= 55 ? "medium" : "low";
      const stories = (f.stories || []).map((st) => ({ kind: "leaf", label: st.story }));
      const confidenceText = avg === null ? "no approved assessment yet" : `${WORD[band]} confidence ${avg}`;
      return {
        kind: "folder",
        label: f.name,
        meta: `${confidenceText} · ${files.length} ${files.length === 1 ? "file" : "files"} · ${stories.length} ${stories.length === 1 ? "story" : "stories"}`,
        children: [
          { kind: "group", tone: "plain", icon: "✎", label: "User stories", children: stories },
          ...files.map((x) => x.node),
        ],
      };
    });
    return {
      kind: "root",
      label: appName || "Application",
      meta: `${features.length} approved ${features.length === 1 ? "capability" : "capabilities"}`,
      children: features,
    };
  }

  root.FeatureTree = { build, TONE };
})(typeof globalThis !== "undefined" ? globalThis : this);
