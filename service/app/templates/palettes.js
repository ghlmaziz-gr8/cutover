// Palette families for the look and feel. Each family sets all six colours together, so a change moves the
// whole palette at once and the colours always belong to one family. Each family has a light and a dark set.
// Every set is checked for contrast in service/app/test/palettes.test.mjs.
(function (root) {
  const FAMILIES = [
    {
      id: "violet",
      name: "Cutover Violet",
      note: "The portal's own colours.",
      light: { primary: "#6d28d9", highlight: "#ec4899", links: "#0e7490", page: "#f7f6ff", surface: "#ffffff", text: "#1d1640", amber: "#f59e0b" },
      dark:  { primary: "#a78bfa", highlight: "#f472b6", links: "#22d3ee", page: "#120e26", surface: "#1c1735", text: "#f3f0ff", amber: "#fbbf24" }
    },
    {
      id: "ocean",
      name: "Ocean",
      note: "Calm blues and teal, for steady, data-heavy screens.",
      light: { primary: "#0369a1", highlight: "#14b8a6", links: "#0e7490", page: "#f0f9ff", surface: "#ffffff", text: "#0c2a3d", amber: "#38bdf8" },
      dark:  { primary: "#38bdf8", highlight: "#2dd4bf", links: "#67e8f9", page: "#071a24", surface: "#0c2636", text: "#e6f6ff", amber: "#7dd3fc" }
    },
    {
      id: "forest",
      name: "Forest",
      note: "Green with a gold highlight, for care and public-sector work.",
      light: { primary: "#047857", highlight: "#ca8a04", links: "#0f766e", page: "#f3f8f4", surface: "#ffffff", text: "#13291d", amber: "#eab308" },
      dark:  { primary: "#34d399", highlight: "#facc15", links: "#5eead4", page: "#0b1a13", surface: "#12281d", text: "#e8f7ee", amber: "#fde047" }
    },
    {
      id: "ember",
      name: "Ember",
      note: "Warm amber and rose, for a friendly, human feel.",
      light: { primary: "#b45309", highlight: "#e11d48", links: "#9a3412", page: "#fdf8f4", surface: "#ffffff", text: "#2a1810", amber: "#f59e0b" },
      dark:  { primary: "#fbbf24", highlight: "#fb7185", links: "#fdba74", page: "#1c110b", surface: "#2a1a10", text: "#fff4ea", amber: "#fcd34d" }
    },
    {
      id: "graphite",
      name: "Graphite",
      note: "Near-neutral slate with one blue accent, for a quiet, serious look.",
      light: { primary: "#334155", highlight: "#0ea5e9", links: "#1d4ed8", page: "#f5f7fa", surface: "#ffffff", text: "#0f172a", amber: "#64748b" },
      dark:  { primary: "#94a3b8", highlight: "#38bdf8", links: "#93c5fd", page: "#0f172a", surface: "#1e293b", text: "#f1f5f9", amber: "#cbd5e1" }
    }
  ];

  // The six colours the page shows, with the names the swatches use.
  const SLOTS = [
    ["Primary", "primary"],
    ["Highlight", "highlight"],
    ["Links and focus", "links"],
    ["Page", "page"],
    ["Surface", "surface"],
    ["Text", "text"]
  ];

  // WCAG contrast between two hex colours, and the label colour (white or the page colour) that reads best on a fill.
  function lum(hex) {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
  }
  function contrast(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function onColour(fill, page) {
    return contrast("#ffffff", fill) >= contrast(page, fill) ? "#ffffff" : page;
  }

  // The custom properties a set writes to the look section. The gradient is built from them in CSS.
  function cssVars(set) {
    return {
      "--p": set.primary,
      "--h": set.highlight,
      "--l": set.links,
      "--page": set.page,
      "--surface": set.surface,
      "--text": set.text,
      "--a3": set.amber,
      "--on": onColour(set.primary, set.page)
    };
  }

  const api = { FAMILIES, SLOTS, cssVars, contrast, onColour };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CutoverPalettes = api;
})(typeof window !== "undefined" ? window : globalThis);
