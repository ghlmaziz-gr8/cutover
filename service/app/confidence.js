// How much of a deep assessment checks out against the code. Pure, so the tests can run it.
// Three parts: the names kept against the names dropped (half the score), rules with a valid line range (under a
// third), and rules with at least one worked example (a fifth). A part with nothing to check counts as half.
(function (root) {
  function share(part, whole, fallback) {
    return whole > 0 ? part / whole : fallback;
  }
  function confidenceOf(content, dropped) {
    const c = content || {};
    const functions = Array.isArray(c.functions) ? c.functions : [];
    const rules = Array.isArray(c.rules) ? c.rules : [];
    const examples = Array.isArray(c.examples) ? c.examples : [];
    let kept = 0;
    for (const fn of functions) {
      kept += 1;
      kept += Array.isArray(fn && fn.calls) ? fn.calls.length : 0;
    }
    const lost = Math.max(0, Number(dropped) || 0);
    const names = share(kept, kept + lost, 0.5);
    const lines = share(rules.filter((r) => Array.isArray(r.lines)).length, rules.length, 0.5);
    const examples_ = share(rules.filter((r) => examples.some((e) => e.rule === r.id)).length, rules.length, 0.5);
    const score = Math.round((0.5 * names + 0.3 * lines + 0.2 * examples_) * 100);
    const band = score >= 80 ? "high" : score >= 55 ? "medium" : "low";
    return {
      score,
      band,
      parts: {
        names: Math.round(names * 100),
        lines: Math.round(lines * 100),
        examples: Math.round(examples_ * 100),
      },
    };
  }
  // The business result is scored on two things only: the function names the code contains (against the names
  // the model dropped) and how many of those functions have line numbers. No worked examples, so the weights differ.
  function businessConfidenceOf(content) {
    const c = content || {};
    const functions = Array.isArray(c.functions) ? c.functions : [];
    const lost = Math.max(0, Number(c.dropped) || 0);
    const names = share(functions.length, functions.length + lost, 0.5);
    const lines = share(functions.filter((fn) => Array.isArray(fn && fn.lines)).length, functions.length, 0.5);
    const score = Math.round((0.6 * names + 0.4 * lines) * 100);
    const band = score >= 80 ? "high" : score >= 55 ? "medium" : "low";
    return { score, band, parts: { names: Math.round(names * 100), lines: Math.round(lines * 100) } };
  }
  root.Confidence = { confidenceOf, businessConfidenceOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
