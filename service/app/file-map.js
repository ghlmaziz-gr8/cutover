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

  function newFolder(name) {
    return { name, folders: new Map(), files: [] };
  }

  // input: { label, files: [{ path }], conversions: [{ path, status, decision }] }
  function tree(input) {
    const all = (input && input.files ? input.files : []).map((f) => f.path).filter(Boolean);
    const byPath = new Map(((input && input.conversions) || []).map((c) => [c.path, c]));
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
          const s = statusOf(byPath.get(path));
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

  root.FileMap = { tree, statusOf, LIMIT };
})(typeof globalThis !== "undefined" ? globalThis : this);
