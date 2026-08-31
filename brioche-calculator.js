// brioche-calculator.js — Cloudflare Worker
//
// Gauge-driven calculator for a top-down circular brioche raglan sweater
// (funnel neck, chevron front, motif sleeve). Sister project to the TDCR
// pipeline; same architecture (this file owns all calculation + rendering).
//
// Implements brioche_build_spec.md §5: solves Y4 (the divide) UPWARD to
// cast-on, even though the garment is knit top-down. All counts are in
// RIBS (1 rib = 2 sts); all parity is rib-parity.
//
// Ported from brioche_reference.py (see that file's module docstring for the
// full derivation). Summary:
//
//   1. GROWTH MODEL IS THE SPEC'S, AS WRITTEN (do not "correct" this toward
//      brioche V7.docx again — an earlier revision of this file did, and it
//      was backwards; V7's stitch tables are the ones with the error, not
//      the spec). Every section grows +2 per full block (front, back-as-
//      ONE-section, each sleeve); light block (max 1, last) = +1 to EVERY
//      section, not a front+2/back+2/sleeve+0 split.
//   2. B = F, relaxed to B = F +/- 1 (never a fixed offset, never V7's
//      specific direction): front is odd everywhere (hard rule -- the
//      chevron needs a center rib), and back is whichever of
//      {front-1, front, front+1} lands closest to the exact body target.
//      This is forced by parity, not style: Y4 total = front+back+2*sleeve,
//      and 2*sleeve is always even, so whenever Y4 total is odd (111 for
//      No2) strict back=front is impossible -- it would force an even
//      total. Back must differ from front by exactly 1 to reach an odd
//      total at all.
//   3. UA is the single outer/searched variable -- it's the one value
//      shared between the sleeve target (appears x1) and the body target
//      (appears x2), so it's the one genuinely binding unknown. For each
//      UA, everything below is closed-form/enumerable, not a multi-term
//      weighted score: sleeve/body Y4 targets are direct arithmetic; block
//      rows/n_light are enumerated and every (rows, n_light) pair that
//      back-solves to a valid pre-raglan AND has a valid one-time-increase
//      is kept, then the single best is picked by how close its block
//      height (rows * 10cm / gauge_rows) is to an empirical ~2.75cm/block
//      constant (from the two known real block heights: No2 10 rows @
//      gauge-rows 37 = 2.70cm, No3 12 rows @ gauge-rows 43 = 2.79cm).
//      Candidates across UA are ranked by |neck - neck_target| alone (no
//      other weighting) -- neck_target is a plain cm->rib conversion, not
//      NECK_RELAX_FACTOR-adjusted; using the relax factor ranked a
//      worse-fitting UA ahead of the one that reproduces the anchor
//      exactly. Every UA that fails records why (sleeve parity / block fit
//      / one-time band), not a bare no-solution.
//
// SURFACED, NOT INVENTED (read before changing #1/#2 again):
//
//   - front-odd is a HARD, closure-checked rule only at Y4 (the chevron's
//     own requirement). In the exact No2 anchor solution, front lands EVEN
//     at the pre-raglan and neck stages (spec §3 also states "front odd"
//     there) -- an unavoidable consequence of the uniform light-block rate
//     (#1) together with the anchor's required block structure (exactly
//     one light block): total front growth is then odd, so front's parity
//     must flip somewhere in the middle. front is odd again at CO/pre-neck
//     because the reduction round flips it back. Reported as
//     info.preraglan_front_odd / info.neck_front_odd (non-hard-error).
//   - Case C (bust 122kg, "large/fine" edge case) resolves with neck ~30%
//     over its input neck_cm even at UA pinned to its max. This
//     architecture computes Y4 rigidly from the bust/arm targets first,
//     and block growth is capped by the armhole row budget; whatever
//     blocks can't absorb has nowhere to go but neck (no body-only-rounds
//     escape valve in this backward derivation). Valid/closure-clean, but
//     a real structural limitation worth flagging, not silently "sane."

// ---- constants (spec §2) ----
const EASE = { close: 2.5, relaxed: 10.0 };
const SLEEVE_EASE_CM = 7;
const FUNNEL_DEPTH_CM = 8;
const PRENECK_MARGIN_RIBS = 3;
const NECK_RELAX_FACTOR = 1.10; // kept per spec §2; NOT used in the UA ranking (see header)
const ONE_TIME_PCT = [0.18, 0.30];
const BLOCK_ROWS = [6, 14];
const UA_MIN_CM = 2;
const BLOCK_HEIGHT_TARGET_CM = 2.75; // empirical, see header note 3

// per-section growth (spec §4, AS WRITTEN -- do not "correct" toward V7; see CLAUDE.md).
const FULL_RATE  = { front: 2, back: 2, sleeve: 2 };
const LIGHT_RATE = { front: 1, back: 1, sleeve: 1 };

const GAUGE_STS_MIN = 8;
const GAUGE_STS_MAX = 20;

function UA_max_cm(bust) {
  return bust < 100 ? 8 : bust < 120 ? 11 : 14;
}
function toOdd(n)  { return n % 2 ? n : n + 1; }
function toEven(n) { return n % 2 ? n + 1 : n; }
function round(n)  { return Math.round(n); }

/**
 * Solve Y4 (divide) upward to CO for one set of body-measurement inputs.
 * UA is the single outer/searched variable; everything else is closed-form
 * per UA (see header note 3). Returns { ok: true, ... } or
 * { ok: false, diagnostics: { UA: reason, ... } } -- never a bare
 * "no_solution" (spec §7 diagnosability fix).
 */
function solve({ bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit }) {
  const bust = bust_cm, arm = upper_arm_cm, gs = gauge_sts, gr = gauge_rows;
  const cmToRibs = (cm) => round((cm * gs) / 10 / 2);

  const fin_bust = bust + EASE[fit];
  const fin_arm = arm + SLEEVE_EASE_CM;

  const body_target_ribs = cmToRibs(fin_bust);             // includes UA x2
  const arm_target_ribs = toEven(round((fin_arm * gs) / 20)); // includes UA x1; forced even (post-UA sleeve even)

  const ua_lo = Math.max(1, round((UA_MIN_CM * gs) / 20));
  const ua_hi = Math.max(ua_lo, Math.floor((UA_max_cm(bust) * gs) / 20));

  const neck_target = round((neck_cm * gs) / 20); // plain cm->rib conversion; see header note 3
  const rows_target = (armhole_cm * gr) / 10;

  const candidates = [];
  const diagnostics = {};

  for (let UA = ua_lo; UA <= ua_hi; UA++) {
    const sleeve_Y4 = arm_target_ribs - UA;
    if ((sleeve_Y4 + UA) % 2 !== 0) {
      diagnostics[UA] = "sleeve_post_UA_parity_fail";
      continue;
    }

    const body_Y4 = body_target_ribs - 2 * UA;
    const front_Y4 = toOdd(round(body_Y4 / 2));
    // back = front, or front +/- 1 if that lands closest to the exact body
    // target (header note 2). Never a fixed offset.
    const backCandidates = [front_Y4 - 1, front_Y4, front_Y4 + 1];
    const back_Y4 = backCandidates.reduce((bestC, c) =>
      Math.abs(front_Y4 + c - body_Y4) < Math.abs(front_Y4 + bestC - body_Y4) ? c : bestC
    );

    const uaValid = [];
    let anyBlockFit = false;
    for (let brow = BLOCK_ROWS[0]; brow <= BLOCK_ROWS[1]; brow++) {
      const nb = round(rows_target / brow);
      if (nb < 1) continue;
      for (let nlight = 0; nlight <= 1; nlight++) {
        const nfull = nb - nlight;
        if (nfull < 1) continue;
        const growth = nfull * FULL_RATE.front + nlight * LIGHT_RATE.front; // same growth for front/back/sleeve
        const sleeve_pr = sleeve_Y4 - growth;
        const front_pr = front_Y4 - growth;
        const back_pr = back_Y4 - growth;
        if (sleeve_pr < 2 || sleeve_pr % 2 !== 0) continue; // pre-raglan sleeve even (spec §3)
        if (front_pr < 1 || back_pr < 1) continue;
        anyBlockFit = true;

        const front_neck = front_pr; // front +0 one-time
        const back_neck = back_pr - 2; // back +1/half = +2 total, one-time
        if (back_neck < 1) continue;
        const CONST = front_neck + back_neck + 2 * sleeve_pr;

        let bestSAdd = null;
        for (let sAdd = 1; sAdd <= 60; sAdd += 2) {
          const neck_total = CONST - 2 * sAdd;
          if (neck_total < 7) break;
          const inc = 2 + 2 * sAdd;
          const lo = Math.ceil(neck_total * ONE_TIME_PCT[0]);
          const hi = Math.floor(neck_total * ONE_TIME_PCT[1]);
          if (lo <= inc && inc <= hi) {
            if (bestSAdd === null || Math.abs(neck_total - neck_target) < Math.abs(bestSAdd.neck_total - neck_target)) {
              bestSAdd = { sAdd, inc, neck_total };
            }
          }
        }
        if (bestSAdd === null) continue;

        const bh_err = Math.abs((brow * 10) / gr - BLOCK_HEIGHT_TARGET_CM);
        uaValid.push({
          brow, nb, nfull, nlight,
          front_pr, back_pr, sleeve_pr, front_neck, back_neck,
          sAdd: bestSAdd.sAdd, inc: bestSAdd.inc, neck: bestSAdd.neck_total,
          bh_err,
        });
      }
    }

    if (uaValid.length === 0) {
      diagnostics[UA] = anyBlockFit ? "one_time_band_fail" : "block_fit_fail";
      continue;
    }

    const bestUA = uaValid.reduce((a, c) => (c.bh_err < a.bh_err ? c : a));
    candidates.push({
      UA, sleeve_Y4, front_Y4, back_Y4,
      ...bestUA,
      CO: bestUA.neck + PRENECK_MARGIN_RIBS,
      neck_dev: Math.abs(bestUA.neck - neck_target),
    });
  }

  if (candidates.length === 0) {
    return { ok: false, diagnostics, neck_target, inputs: { bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit } };
  }

  const b = candidates.reduce((a, c) => (c.neck_dev < a.neck_dev ? c : a)); // single criterion, no weighted score
  const funnel_rows = toEven(round((FUNNEL_DEPTH_CM * gr) / 10));
  const preraglan_ribs = b.front_pr + b.back_pr + 2 * b.sleeve_pr;
  const Y4_ribs = b.front_Y4 + b.back_Y4 + 2 * b.sleeve_Y4;
  const SL_post = b.sleeve_Y4 + b.UA;
  const B_post = b.front_Y4 + b.back_Y4 + 2 * b.UA;

  // TDCR-style closure booleans -- these hold by construction; hard-error if any are false.
  const closure_checks = {
    y4_front_odd: b.front_Y4 % 2 === 1,
    y4_back_within_one: Math.abs(b.back_Y4 - b.front_Y4) <= 1,
    sleeve_post_even: SL_post % 2 === 0,
    preraglan_sleeve_even: b.sleeve_pr % 2 === 0,
  };
  // informational only -- see header "SURFACED, NOT INVENTED". Can legitimately be
  // false (it is, for the exact No2 anchor) without being a construction error.
  const info = {
    preraglan_front_odd: b.front_pr % 2 === 1,
    neck_front_odd: b.front_neck % 2 === 1,
  };

  const backHalf = Math.floor(b.back_pr / 2);
  const y4BackHalf = Math.floor(b.back_Y4 / 2);
  const neckBackHalf = Math.floor(b.back_neck / 2);
  const s_neck = b.sleeve_pr - b.sAdd;
  const f_preneck = b.front_neck + 1;
  const s_preneck = s_neck + 1;
  const b_preneck_half = neckBackHalf;

  return {
    ok: true,
    CO_ribs: b.CO,
    CO_cm: round((b.CO * 2) / gs * 10 * 10) / 10,
    neck_ribs: b.neck,
    neck_cm: round((b.neck * 2) / gs * 10 * 10) / 10,
    neck_target,
    distributions: {
      preneck: [b_preneck_half, s_preneck, f_preneck, s_preneck, b_preneck_half],
      neck: [neckBackHalf, s_neck, b.front_neck, s_neck, neckBackHalf],
      preraglan: [backHalf, b.sleeve_pr, b.front_pr, b.sleeve_pr, b.back_pr - backHalf],
      Y4: [y4BackHalf, b.sleeve_Y4, b.front_Y4, b.sleeve_Y4, b.back_Y4 - y4BackHalf],
    },
    one_time_inc: b.inc,
    one_time_dist: { back_each_half: 1, sleeve_each: b.sAdd, front: 0 },
    preraglan_ribs,
    blocks: { full: b.nfull, light: b.nlight, rows_each: b.brow, n_blocks: b.nb },
    funnel_rows,
    Y4_ribs,
    Y4: {
      front: b.front_Y4, back: b.back_Y4, sleeve_preUA: b.sleeve_Y4, UA: b.UA,
      SL_post, B_post,
      finished_bust_cm: Math.round((B_post * 2 / gs * 10) * 10) / 10,
      finished_sleeve_cm: Math.round((SL_post * 2 / gs * 10) * 10) / 10,
    },
    closure_checks,
    info,
  };
}

// ---- spec §0 validation harness ----
const HARNESS = {
  No1: { bust_cm: 80,  upper_arm_cm: 28, neck_cm: 50, armhole_cm: 25,   gauge_sts: 10,   gauge_rows: 30, fit: "close" },
  No2: { bust_cm: 97,  upper_arm_cm: 33, neck_cm: 56, armhole_cm: 25.5, gauge_sts: 13,   gauge_rows: 37, fit: "relaxed" },
  No3: { bust_cm: 97,  upper_arm_cm: 35, neck_cm: 56, armhole_cm: 25.5, gauge_sts: 12.5, gauge_rows: 43, fit: "relaxed" },
  B:   { bust_cm: 76,  upper_arm_cm: 26, neck_cm: 48, armhole_cm: 22,   gauge_sts: 8,    gauge_rows: 26, fit: "close" },
  C:   { bust_cm: 122, upper_arm_cm: 42, neck_cm: 60, armhole_cm: 28,   gauge_sts: 20,   gauge_rows: 48, fit: "relaxed" },
};

// No2 anchor targets (spec §0 / README) -- checked EXACT (gap must be 0).
const NO2_ANCHOR = { CO_ribs: 38, neck_ribs: 35, preraglan_ribs: 43, one_time_inc: 8, Y4_ribs: 111 };

// ---- input validation ----
function validateInputs(body) {
  const errors = [];
  const num = (v, name, { min, max } = {}) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) { errors.push(`${name} is required and must be a number`); return null; }
    if (min !== undefined && n < min) errors.push(`${name} ${n} is below minimum ${min}`);
    if (max !== undefined && n > max) errors.push(`${name} ${n} is above maximum ${max}`);
    return n;
  };
  const bust_cm = num(body.bust_cm, "bust_cm", { min: 1 });
  const upper_arm_cm = num(body.upper_arm_cm, "upper_arm_cm", { min: 1 });
  const neck_cm = num(body.neck_cm, "neck_cm", { min: 1 });
  const armhole_cm = num(body.armhole_cm, "armhole_cm", { min: 1 }); // spec §7: per-size table OPEN, taken as input for now
  const gauge_sts = num(body.gauge_sts, "gauge_sts", { min: GAUGE_STS_MIN, max: GAUGE_STS_MAX });
  const gauge_rows = num(body.gauge_rows, "gauge_rows", { min: 1 });
  const fit = String(body.fit ?? "").trim().toLowerCase();
  if (fit !== "close" && fit !== "relaxed") errors.push('fit must be "close" or "relaxed"');
  return { errors, inputs: { bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit } };
}

// ---- HTML rendering ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderResultHTML(inputs, result) {
  if (!result.ok) {
    const reasons = Object.entries(result.diagnostics)
      .map(([ua, reason]) => `<li>UA ${ua}: ${escapeHtml(reason)}</li>`).join("\n        ");
    return `<section class="result error">
      <h2>No solution found</h2>
      <p>No UA in range yielded a valid combination. Reason per UA tried:</p>
      <ul>
        ${reasons}
      </ul>
    </section>`;
  }
  const checks = result.closure_checks;
  const allOk = Object.values(checks).every(Boolean);
  const dist5 = (arr) => `Lback ${arr[0]} · Lsleeve ${arr[1]} · Front ${arr[2]} · Rsleeve ${arr[3]} · Rback ${arr[4]}`;
  return `<section class="result">
    <h2>Result <span class="badge ${allOk ? "ok" : "fail"}">${allOk ? "closure OK" : "CLOSURE FAILED"}</span></h2>
    <table class="summary">
      <tr><th>Cast-on (pre-neck)</th><td>${result.CO_ribs} ribs (${result.CO_cm} cm) — ${dist5(result.distributions.preneck)}</td></tr>
      <tr><th>Neck (after reduction)</th><td>${result.neck_ribs} ribs (${result.neck_cm} cm) — ${dist5(result.distributions.neck)}</td></tr>
      <tr><th>Funnel rows</th><td>${result.funnel_rows}</td></tr>
      <tr><th>One-time increase</th><td>+${result.one_time_inc} ribs (back +1/half, sleeve +${result.one_time_dist.sleeve_each}/each, front +0)</td></tr>
      <tr><th>Pre-raglan</th><td>${result.preraglan_ribs} ribs — ${dist5(result.distributions.preraglan)}</td></tr>
      <tr><th>Blocks</th><td>${result.blocks.full} full + ${result.blocks.light} light × ${result.blocks.rows_each} rows (${result.blocks.n_blocks} total)</td></tr>
      <tr><th>Y4 (divide)</th><td>${result.Y4_ribs} ribs — ${dist5(result.distributions.Y4)}</td></tr>
      <tr><th>Underarm cast-on</th><td>${result.Y4.UA} ribs each side</td></tr>
      <tr><th>Finished bust</th><td>${result.Y4.B_post} ribs (${result.Y4.finished_bust_cm} cm)</td></tr>
      <tr><th>Finished sleeve</th><td>${result.Y4.SL_post} ribs (${result.Y4.finished_sleeve_cm} cm)</td></tr>
    </table>
    <h3>Closure checks</h3>
    <ul class="checks">
      ${Object.entries(checks).map(([k, v]) => `<li class="${v ? "pass" : "fail"}">${v ? "✓" : "✗"} ${escapeHtml(k)}</li>`).join("\n      ")}
    </ul>
    <p class="note">Informational (not hard-checked — see brioche_reference.py header for why
    these can legitimately be false): ${Object.entries(result.info).map(([k, v]) => `${escapeHtml(k)}=${v}`).join(", ")}</p>
  </section>`;
}

function renderPage({ inputs = {}, result = null, error = null } = {}) {
  const val = (k, d = "") => escapeHtml(inputs[k] ?? d);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brioche Raglan Calculator</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.4rem; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 1rem; margin: 1.5rem 0; }
  label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 0.25rem; }
  input, select { padding: 0.4rem; font-size: 1rem; }
  button { grid-column: 1 / -1; padding: 0.6rem; font-size: 1rem; cursor: pointer; }
  table.summary { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  table.summary th, table.summary td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid #ddd; }
  table.summary th { width: 40%; color: #555; font-weight: 600; }
  .badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; margin-left: 0.5rem; }
  .badge.ok { background: #d7f5df; color: #16631f; }
  .badge.fail { background: #fbdada; color: #8a1414; }
  ul.checks { list-style: none; padding: 0; }
  ul.checks li.pass { color: #16631f; }
  ul.checks li.fail { color: #8a1414; font-weight: 600; }
  .error { color: #8a1414; }
  .note { font-size: 0.8rem; color: #666; }
</style>
</head>
<body>
  <h1>Brioche Raglan Calculator</h1>
  <p class="note">Solves the CO→Y4 yoke from the divide upward to cast-on. Sleeve
  below Y4 (motif/decreases), body below Y4 (chevron/hem), and cuff are not yet
  implemented — see brioche_build_spec.md §7.</p>
  <form method="POST">
    <label>Bust (cm)<input type="number" step="0.1" name="bust_cm" value="${val("bust_cm", 97)}" required></label>
    <label>Upper arm (cm)<input type="number" step="0.1" name="upper_arm_cm" value="${val("upper_arm_cm", 33)}" required></label>
    <label>Neck (cm)<input type="number" step="0.1" name="neck_cm" value="${val("neck_cm", 56)}" required></label>
    <label>Armhole depth (cm)<input type="number" step="0.1" name="armhole_cm" value="${val("armhole_cm", 25.5)}" required></label>
    <label>Gauge sts/10cm<input type="number" step="0.1" name="gauge_sts" value="${val("gauge_sts", 13)}" required></label>
    <label>Gauge rows/10cm<input type="number" step="0.1" name="gauge_rows" value="${val("gauge_rows", 37)}" required></label>
    <label>Fit
      <select name="fit">
        <option value="relaxed" ${inputs.fit === "relaxed" ? "selected" : ""}>Relaxed</option>
        <option value="close" ${inputs.fit === "close" ? "selected" : ""}>Close</option>
      </select>
    </label>
    <button type="submit">Calculate</button>
  </form>
  ${error ? `<section class="result error"><h2>Error</h2><ul>${error.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></section>` : ""}
  ${result ? renderResultHTML(inputs, result) : ""}
</body>
</html>`;
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  // best-effort fallback
  try { return await request.json(); } catch { return {}; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const wantsJson = url.searchParams.get("format") === "json" ||
      (request.headers.get("accept") || "").includes("application/json");

    if (request.method === "GET" && url.pathname === "/harness") {
      const results = {};
      let allOk = true;
      for (const [name, args] of Object.entries(HARNESS)) {
        const r = solve(args);
        results[name] = r;
        if (!r.ok || !Object.values(r.closure_checks).every(Boolean)) allOk = false;
      }
      const no2 = results.No2;
      const anchor = {};
      if (no2.ok) {
        for (const [field, target] of Object.entries(NO2_ANCHOR)) {
          const achieved = no2[field];
          const gap = Math.abs(achieved - target);
          anchor[field] = { target, achieved, gap, ok: gap === 0 };
          if (gap !== 0) allOk = false;
        }
      } else {
        allOk = false;
      }
      return new Response(JSON.stringify({ ok: allOk, results, no2_anchor: anchor }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      return new Response(renderPage({}), { headers: { ...corsHeaders, "Content-Type": "text/html;charset=UTF-8" } });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use GET or POST" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let body;
    try {
      body = await readBody(request);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { errors, inputs } = validateInputs(body);
    if (errors.length) {
      if (wantsJson) {
        return new Response(JSON.stringify({ error: errors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(renderPage({ inputs: body, error: errors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html;charset=UTF-8" } });
    }

    const result = solve(inputs);

    // Hard-error on any parity/closure failure (spec §6).
    if (result.ok && !Object.values(result.closure_checks).every(Boolean)) {
      const failed = Object.entries(result.closure_checks).filter(([, v]) => !v).map(([k]) => k);
      const payload = { error: "closure_check_failed", failed, result };
      if (wantsJson) {
        return new Response(JSON.stringify(payload), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(renderPage({ inputs, error: [`Closure check(s) failed: ${failed.join(", ")}`], result }), { status: 422, headers: { ...corsHeaders, "Content-Type": "text/html;charset=UTF-8" } });
    }

    if (wantsJson) {
      return new Response(JSON.stringify(result, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(renderPage({ inputs, result }), { headers: { ...corsHeaders, "Content-Type": "text/html;charset=UTF-8" } });
  },
};

export { solve, HARNESS, NO2_ANCHOR, validateInputs };
