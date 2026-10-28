// A treemap of the draft features, where each rectangle's area is proportional to the feature's complexity.
// Complexity = the user stories + the distinct rules cited + the files in the feature. Squarified layout, pure, so the
// tests can run it. Sample data only; no agent or model is named.
(function (root) {
  // How complex one feature is, from its stories, the distinct rules its stories cite, and its files.
  function complexityOf(group) {
    const stories = Array.isArray(group.stories) ? group.stories : [];
    const rules = new Set();
    for (const st of stories) for (const r of st.rules || []) rules.add(`${r.file} · ${r.id}`);
    const files = new Set(group.paths || []).size;
    return { stories: stories.length, rules: rules.size, files, total: stories.length + rules.size + files };
  }

  // Lays the items out as rectangles. items: [{ key, value }]. Returns [{ key, x, y, w, h }] filling width × height.
  function layout(items, width, height) {
    const list = (items || []).filter((i) => i && i.value > 0).sort((a, b) => b.value - a.value);
    const total = list.reduce((a, b) => a + b.value, 0);
    if (!total || !(width > 0) || !(height > 0)) return [];
    const areas = list.map((i) => (i.value / total) * width * height);
    const out = [];
    let rect = { x: 0, y: 0, w: width, h: height };
    let row = [];
    let start = 0;
    // The worst aspect ratio of a row laid along a side of length `side`. Lower is squarer.
    const worst = (r, side) => {
      const s = r.reduce((a, b) => a + b, 0);
      return Math.max((side * side * Math.max(...r)) / (s * s), (s * s) / (side * side * Math.min(...r)));
    };
    const place = (r, from) => {
      const s = r.reduce((a, b) => a + b, 0);
      if (rect.w >= rect.h) {
        // The row fills a column on the left, as tall as the rectangle.
        const colW = s / rect.h;
        let y = rect.y;
        r.forEach((a, k) => {
          const hh = a / colW;
          out.push({ key: list[from + k].key, x: rect.x, y, w: colW, h: hh });
          y += hh;
        });
        rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
      } else {
        // The row fills a band across the top, as wide as the rectangle.
        const rowH = s / rect.w;
        let x = rect.x;
        r.forEach((a, k) => {
          const ww = a / rowH;
          out.push({ key: list[from + k].key, x, y: rect.y, w: ww, h: rowH });
          x += ww;
        });
        rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
      }
    };
    for (let i = 0; i < areas.length; i++) {
      const side = Math.min(rect.w, rect.h);
      const candidate = [...row, areas[i]];
      if (!row.length || worst(candidate, side) <= worst(row, side)) {
        row = candidate;
      } else {
        place(row, start);
        start = i;
        row = [areas[i]];
      }
    }
    if (row.length) place(row, start);
    return out;
  }

  // The readiness colour band of a feature, from its checks: all passed is high, one missing is medium, more is low.
  function band(passed, total) {
    if (passed === total) return "high";
    return passed >= total - 1 ? "medium" : "low";
  }

  root.ComplexityTreemap = { complexityOf, layout, band };
})(typeof globalThis !== "undefined" ? globalThis : this);
