// A squarified treemap: each area's tile is in proportion to its value, and the tiles are kept close to square so
// they stay easy to compare and to read. Pure, so the tests can run it.
(function (root) {
  // The worst aspect ratio of a row of areas laid along a side of length `side`.
  function worst(row, side) {
    const sum = row.reduce((a, r) => a + r.area, 0);
    const max = Math.max(...row.map((r) => r.area));
    const min = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  }

  // Items are {label, value, color}. Returns the same items with x, y, w, h inside a box of width w and height h.
  function layout(items, width, height) {
    const live = (items || []).filter((i) => Number(i.value) > 0).slice().sort((a, b) => b.value - a.value);
    const total = live.reduce((a, i) => a + Number(i.value), 0);
    if (!live.length || !(width > 0) || !(height > 0)) return [];
    const scale = (width * height) / total;
    let rest = live.map((i) => ({ item: i, area: Number(i.value) * scale }));
    const out = [];
    let x = 0;
    let y = 0;
    let w = width;
    let h = height;
    while (rest.length) {
      const side = Math.min(w, h);
      const row = [rest[0]];
      let k = 1;
      while (k < rest.length && worst(row.concat(rest[k]), side) <= worst(row, side)) {
        row.push(rest[k]);
        k += 1;
      }
      const rowArea = row.reduce((a, r) => a + r.area, 0);
      if (w >= h) {
        // A column on the left, as tall as the box.
        const colW = rowArea / h;
        let cy = y;
        for (const r of row) {
          const tileH = r.area / colW;
          out.push({ ...r.item, x, y: cy, w: colW, h: tileH });
          cy += tileH;
        }
        x += colW;
        w -= colW;
      } else {
        // A row along the top, as wide as the box.
        const rowH = rowArea / w;
        let cx = x;
        for (const r of row) {
          const tileW = r.area / rowH;
          out.push({ ...r.item, x: cx, y, w: tileW, h: rowH });
          cx += tileW;
        }
        y += rowH;
        h -= rowH;
      }
      rest = rest.slice(row.length);
    }
    return out;
  }

  root.TreeMap = { layout };
})(typeof globalThis !== "undefined" ? globalThis : this);
