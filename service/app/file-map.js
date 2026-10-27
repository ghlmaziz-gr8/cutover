// Converted-code map: the repository's files, grouped by folder, coloured by where each one stands in conversion.
// Built from the file list and the conversion results the engineer may see. Labels are file names and statuses only.
// Run: node --test service/app/test/file-map.test.mjs
(function (root) {
  const LIMIT = 400;

  // Where one file stands. A conversion that did not finish is "needs attention", not a failure of the file.
  function statusOf(c) {
    if (!c) return { tone: "plain", text: "Not started" };
    if (c.status === "ok") {
      if (c.decision === "accepted") return { tone: "pro", text: "Accepted" };
      if (c.decision === "rejected") return { tone: "con", text: "Rejected" };
      return { tone: "possible", text: "Proposed, to review" };
    }
    return { tone: "fit", text: "Needs attention" };
  }

  // The deep assessment of a file, when it has one. It takes the place of the conversion status on the map.
  function deepStatusOf(d) {
    if (!d) return null;
    if (d.state === "running") return { tone: "possible", text: "Assessing" };
    if (d.state === "draft") return { tone: "pro", text: "Draft ready" };
    if (d.state === "approved") return { tone: "pro", text: "Approved" };
    if (d.state === "failed") return { tone: "con", text: "Failed" };
    if (d.state === "superseded") return { tone: "plain", text: "Replaced" };
    return null;
  }

  function newFolder(name) {
    return { name, folders: new Map(), files: [] };
  }

  // input: { label, files: [{ path }], conversions: [{ path, status, decision }] }
  function tree(input) {
    const all = (input && input.files ? input.files : []).map((f) => f.path).filter(Boolean);
    const byPath = new Map(((input && input.conversions) || []).map((c) => [c.path, c]));
    const deepBy = (input && input.deep) || {};
    const shown = all.slice(0, LIMIT);
    const counts = { pro: 0, possible: 0, con: 0, fit: 0, plain: 0 };

    const top = newFolder("");
    for (const path of shown) {
      const parts = path.split("/");
      let node = top;
      for (const part of parts.slice(0, -1)) {
        if (!node.folders.has(part)) node.folders.set(part, newFolder(part));
        node = node.folders.get(part);
      }
      node.files.push(path);
    }

    const toNode = (folder) => {
      const folders = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
      const files = folder.files.slice().sort((a, b) => a.localeCompare(b));
      const children = [
        ...folders.map(toNode),
        ...files.map((path) => {
          const s = deepStatusOf(deepBy[path]) || statusOf(byPath.get(path));
          counts[s.tone] += 1;
          const base = path.split("/").pop();
          return { kind: "leaf", tone: s.tone, path, label: `${base} · ${s.text}` };
        }),
      ];
      const count = countFiles(folder);
      return { kind: "folder", label: folder.name, meta: `${count} file${count === 1 ? "" : "s"}`, children };
    };

    const countFiles = (f) => f.files.length + [...f.folders.values()].reduce((n, x) => n + countFiles(x), 0);

    const children = toNode(top).children;
    const note = all.length > LIMIT ? ` Showing the first ${LIMIT} of ${all.length} files.` : "";
    return {
      kind: "root",
      label: (input && input.label) || "Files in the repository",
      meta: `${counts.pro} accepted · ${counts.possible} to review · ${counts.con} rejected · ${counts.fit} need attention · ${counts.plain} not started.${note}`,
      children,
    };
  }

  // Files that probably belong with a chosen file, from the paths alone: the same folder, and a name that
  // shares its start after a common include prefix is removed. Content-based links come later, from an index.
  function stemOf(path) {
    const base = String(path || "").split("/").pop().replace(/\.[^.]*$/, "").toLowerCase();
    return base.replace(/^(inc|include|common)[_-]?/, "").replace(/[_-]/g, "");
  }
  function folderOf(path) {
    const parts = String(path || "").split("/");
    parts.pop();
    return parts.join("/");
  }
  function sharedStart(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    return n;
  }
  function related(path, paths, limit = 6) {
    const stem = stemOf(path);
    const folder = folderOf(path);
    const found = [];
    for (const other of paths || []) {
      if (other === path) continue;
      let score = 0;
      const reasons = [];
      if (folderOf(other) === folder) {
        score += 2;
        reasons.push("same folder");
      }
      const shared = sharedStart(stem, stemOf(other));
      if (shared >= 4) {
        score += 3;
        reasons.push(`similar name (starts "${stemOf(other).slice(0, shared)}")`);
      }
      if (score > 0) found.push({ path: other, score, reason: reasons.join(", ") });
    }
    found.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path));
    return found.slice(0, limit);
  }
  // The order to assess files in: the chosen file, then its related files, then everything else in path order.
  function processingOrder(path, paths) {
    const near = related(path, paths, Infinity).map((r) => r.path);
    const rest = (paths || []).filter((p) => p !== path && !near.includes(p)).sort((a, b) => a.localeCompare(b));
    return [path, ...near, ...rest];
  }

  root.FileMap = { tree, statusOf, deepStatusOf, related, processingOrder, LIMIT };
})(typeof globalThis !== "undefined" ? globalThis : this);
