// Side-by-side comparison of a file and its proposed conversion. Pure: no page code.
// A line is marked when it has no exact match on the other side. Blank lines are never marked.
// Run: node --test service/app/test/compare.test.mjs
(function (root) {
  function changedLines(lines, other) {
    const seen = new Set(other);
    return lines.map((t) => t.trim() !== "" && !seen.has(t));
  }
  root.Compare = { changedLines };
})(typeof globalThis !== "undefined" ? globalThis : this);
