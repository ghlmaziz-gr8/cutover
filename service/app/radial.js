// Radial mind map: the root in the middle, branches on both sides, and each branch's points as outlined pills.
// Built as SVG with no library. Layout is pure (build), so it can be tested without a browser.
// Run: node --test service/app/test/radial.test.mjs
(function (root) {
  const VIEW_W = 1200;
  const CX = VIEW_W / 2;
  const BRANCH_X = 215;   // distance of branch pills from the centre
  const LEAF_X = 470;     // distance of point pills from the centre
  const SLOT = 64;        // vertical space for one point
  const PALETTE = ["#16a34a", "#0d9488", "#2563eb", "#9333ea", "#db2777", "#dc2626", "#ea580c", "#0891b2"];
  const MAX_LEAVES = 8;
  const ICON = { pro: "✓", con: "!", fit: "◎", possible: "?", plain: "•", evidence: "●", high: "!", medium: "!", low: "•", clear: "✓" };

  // Breaks text into at most two lines of about `max` characters, ending with an ellipsis if cut.
  function wrap(text, max) {
    const s = String(text || "");
    if (s.length <= max) return [s];
    const cut = s.lastIndexOf(" ", max);
    const first = cut > max * 0.5 ? s.slice(0, cut) : s.slice(0, max);
    let rest = s.slice(first.length).trim();
    if (rest.length > max) rest = `${rest.slice(0, max - 1).trimEnd()}…`;
    return [first, rest];
  }

  // The points of a branch: its own leaves, plus the leaves of its groups, each with the group's icon.
  function points(children) {
    const out = [];
    for (const c of children || []) {
      if (c.children && c.children.length) {
        for (const g of c.children) out.push({ label: g.label, icon: ICON[g.tone] || ICON[c.tone] || "•", tone: g.tone || c.tone || "plain", path: g.path });
      } else {
        out.push({ label: c.label, icon: ICON[c.tone] || "•", tone: c.tone || "plain", path: c.path });
      }
    }
    return out;
  }

  // Lays out the tree. Branches alternate right and left. Returns plain numbers only.
  function build(tree) {
    const branches = (tree && tree.children) || [];
    const sides = { right: [], left: [] };
    branches.forEach((b, i) => {
      const side = i % 2 === 0 ? "right" : "left";
      const pts = points(b.children).slice(0, MAX_LEAVES);
      const more = points(b.children).length - pts.length;
      if (more > 0) pts.push({ label: `${more} more`, icon: "…", tone: "plain", more: true });
      sides[side].push({ src: b, pts, color: PALETTE[i % PALETTE.length], index: i });
    });
    const heights = Object.fromEntries(Object.entries(sides).map(([k, list]) => [k, list.reduce((n, b) => n + Math.max(1, b.pts.length) * SLOT + 24, 0)]));
    const viewH = Math.max(360, Math.max(heights.right, heights.left) + 140);
    const cy = viewH / 2;
    const out = [];
    for (const side of ["right", "left"]) {
      const dir = side === "right" ? 1 : -1;
      let y = cy - heights[side] / 2;
      for (const b of sides[side]) {
        const slot = Math.max(1, b.pts.length) * SLOT;
        const by = y + slot / 2;
        const leaves = b.pts.map((p, i) => ({
          x: CX + dir * LEAF_X, y: y + i * SLOT + SLOT / 2, dir,
          label: p.label, icon: p.icon, tone: p.tone, path: p.path, more: !!p.more,
          lines: wrap(p.label, 27),
        }));
        out.push({
          id: b.src.id || `branch-${b.index}`, label: b.src.label, tone: b.src.tone || "plain", fitText: b.src.fitText || "",
          chosen: !!b.src.chosen, color: b.color, index: b.index, side, dir,
          x: CX + dir * BRANCH_X, y: by, lines: wrap(b.src.label, 24), leaves,
        });
        y += slot + 24;
      }
    }
    return {
      viewW: VIEW_W, viewH,
      root: { x: CX, y: cy, label: (tree && tree.label) || "", lines: wrap((tree && tree.label) || "", 28) },
      branches: out.sort((a, b) => a.index - b.index),
    };
  }

  // The curve from a parent point to a child point, with horizontal tangents.
  function curve(x1, y1, x2, y2) {
    const mid = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
  }

  root.Radial = { build, curve, wrap, PALETTE, VIEW_W, CX, LEAF_X, BRANCH_X, SLOT };
})(typeof globalThis !== "undefined" ? globalThis : this);
