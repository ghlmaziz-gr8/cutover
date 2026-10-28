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

  // Clips a convex polygon to the half-plane a*x + b*y <= c (Sutherland–Hodgman).
  function clip(poly, a, b, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const fp = a * P[0] + b * P[1] - c, fq = a * Q[0] + b * Q[1] - c;
      if (fp <= 0) out.push(P);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
        const t = fp / (fp - fq);
        out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
    return out;
  }
  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; }
    return Math.abs(s) / 2;
  }
  function polyCentroid(p) {
    let A = 0, x = 0, y = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length], c = x1 * y2 - x2 * y1;
      A += c; x += (x1 + x2) * c; y += (y1 + y2) * c;
    }
    A /= 2;
    return A ? [x / (6 * A), y / (6 * A)] : null;
  }
  // The cell of each site in a weighted (power) diagram clipped to the box. Each cell is an intersection of
  // half-planes, so it is convex.
  function cellsOf(sites, weights, box) {
    return sites.map((p, i) => {
      let poly = box;
      for (let j = 0; j < sites.length && poly.length; j++) {
        if (j === i) continue;
        const [xi, yi] = p, [xj, yj] = sites[j];
        poly = clip(poly, 2 * (xj - xi), 2 * (yj - yi), xj * xj + yj * yj - weights[j] - (xi * xi + yi * yi) + weights[i]);
      }
      return poly;
    });
  }

  // Convex cells that tile width × height, each with an area in proportion to its value. Items: [{ key, value }].
  // Returns [{ key, points, cx, cy, area }], where points is the convex polygon and cx, cy its centre for a label.
  // Weights are adjusted until each area matches its share; the sites drift toward their cells' centres so the shapes stay even.
  function convex(items, width, height, iters = 400) {
    if (!(width > 0) || !(height > 0)) return [];
    return convexIn([[0, 0], [width, 0], [width, height], [0, height]], items, iters);
  }

  // Convex cells that tile a convex polygon, each with an area in proportion to its value. Same method as convex.
  function convexIn(box, items, iters = 400) {
    const list = (items || []).filter((i) => i && i.value > 0).sort((a, b) => b.value - a.value);
    const total = list.reduce((a, b) => a + b.value, 0);
    const A = polyArea(box);
    if (!total || !(A > 0) || box.length < 3) return [];
    const n = list.length;
    const target = list.map((i) => (i.value / total) * A);
    if (n === 1) {
      const c = polyCentroid(box) || box[0];
      return [{ key: list[0].key, points: box, cx: c[0], cy: c[1], area: A }];
    }
    // Start from the squarified layout of the box's bounding rectangle, so the cells begin where the rectangles were.
    const minX = Math.min(...box.map((p) => p[0])), minY = Math.min(...box.map((p) => p[1]));
    const W = Math.max(...box.map((p) => p[0])) - minX, H = Math.max(...box.map((p) => p[1])) - minY;
    const seed = layout(list, W, H);
    const sites = list.map((i) => { const r = seed.find((c) => c.key === i.key); return [minX + r.x + r.w / 2, minY + r.y + r.h / 2]; });
    const weights = new Array(n).fill(0);
    for (let it = 0; it < iters; it++) {
      const cells = cellsOf(sites, weights, box);
      const decay = 0.5 * (1 - it / iters) + 1e-3;
      for (let i = 0; i < n; i++) {
        const a = polyArea(cells[i]), c = polyCentroid(cells[i]);
        if (c) { sites[i][0] += 0.2 * (c[0] - sites[i][0]); sites[i][1] += 0.2 * (c[1] - sites[i][1]); }
        // Each cell's step is scaled to its own target area, so small cells are not thrown out of the box.
        weights[i] += decay * target[i] * Math.max(-1, Math.min(1, (target[i] - a) / target[i]));
      }
    }
    const cells = cellsOf(sites, weights, box);
    return list.map((item, i) => {
      const poly = cells[i], c = polyCentroid(poly) || sites[i];
      return { key: item.key, points: poly, cx: c[0], cy: c[1], area: polyArea(poly) };
    });
  }

  root.ComplexityTreemap = { complexityOf, layout, band, convex, convexIn };
})(typeof globalThis !== "undefined" ? globalThis : this);
