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
// full derivation). Summary of the corrections made vs the original spec
// text, all verified against brioche V7.docx (the actual knitted pattern —
// primary source per the project's own rules):
//
//   1. Pre-raglan/Y4 back is B = F+1 (or F-1), not "B = F" (spec §3/§4).
//      V7's own text: "F = odd No of ribs; B = F+1; sleeves = even No of
//      ribs". This also falls out of parity: Y4 total = front+back+2*sleeve,
//      2*sleeve is always even, so whenever Y4 total is odd, front+back must
//      be odd — strict B=F is impossible whenever front is odd (a hard rule)
//      and Y4 total is odd, as it is for the No2 anchor (111).
//   2. Light-block per-section split (spec §7, explicitly flagged
//      "unverified") is front+2 / back+2(one section) / sleeve+0(each), not
//      "+1 to each section". Verified by reproducing V7's exact
//      division-row stitch table (pre-raglan 13/8/14 -> Y4 31/24ea/32 via
//      8 full + 1 light block). This is also why front parity never flips
//      from pre-raglan to Y4: every block adds an EVEN number to front.
//   3. UA (underarm cast-on) doesn't drive the block-growth search — blocks
//      grow front/back/sleeve independent of UA (UA stitches are cast on
//      separately at the division round). UA is chosen AFTER block growth,
//      as a fine-tuner, matching spec's own framing.
//   4. Block-row height is additionally scored against an empirical
//      constant-cm target (~2.75cm/block), derived from the two known real
//      block heights (No2: 10 rows @ gr37 = 2.70cm; No3: 12 rows @ gr43 =
//      2.79cm) — reproduces both real block-row counts exactly.
//
// KNOWN RESIDUAL GAP: with valid parity everywhere, the No2 anchor lands
// within 2 ribs on CO/neck/pre-raglan/Y4 (36/33/41/109 vs 38/35/43/111),
// while one_time_inc(+8) and the block structure (9 blocks x 10 rows) match
// exactly. Traced to NECK_RELAX_FACTOR=1.10 (spec §2) predicting
// neck_ideal=33 for No2, vs V7's real neck of 35 (implying an effective
// factor of ~1.03-1.05 for that specific sample). Neck is an explicit SOFT
// target (README: "Neck is a soft target; Y4 targets + parity win"), so
// this is treated as in-tolerance per spec §0's own bar (+/-2 ribs) rather
// than hard-coded. See PR description for the full write-up.

// ---- constants (spec §2) ----
const EASE = { close: 2.5, relaxed: 10.0 };
const SLEEVE_EASE_CM = 7;
const FUNNEL_DEPTH_CM = 8;
const PRENECK_MARGIN_RIBS = 3;
const NECK_RELAX_FACTOR = 1.10;
const ONE_TIME_PCT = [0.18, 0.30];
const BLOCK_ROWS = [6, 14];
const UA_MIN_CM = 2;
const BLOCK_HEIGHT_TARGET_CM = 2.75; // empirical, see correction #4 above
const FRONT_FRAC = 13 / 18;          // empirical split of (front+sleeve-base) at neck stage, from V7 No2

// per-section growth (spec §4, corrected per note 2 above): back = Lb+Rb as ONE section.
const FULL_RATE  = { front: 2, back: 2, sleeve: 2 };
const LIGHT_RATE = { front: 2, back: 2, sleeve: 0 };

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
 * Returns { ok: true, ...result } or { ok: false, error } — never throws
 * for a "no solution found" outcome; throws only on invalid input shape
 * (caller's responsibility to validate before calling, see fetch handler).
 */
function solve({ bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit }) {
  const bust = bust_cm, arm = upper_arm_cm, gs = gauge_sts, gr = gauge_rows;
  const cmToRibs = (cm) => round((cm * gs) / 10 / 2);

  const fin_bust = bust + EASE[fit];
  const fin_arm = arm + SLEEVE_EASE_CM;

  const sleeve_total = cmToRibs(fin_arm);
  const body_total = cmToRibs(fin_bust);
  const ua_lo = Math.max(1, round((UA_MIN_CM * gs) / 20));
  const ua_hi = Math.max(ua_lo, Math.floor((UA_max_cm(bust) * gs) / 20));

  const neck_ideal = round((neck_cm / NECK_RELAX_FACTOR) * gs / 20);
  const rows_target = (armhole_cm * gr) / 10;

  let best = null;

  for (let neck = Math.max(7, neck_ideal - 4); neck < neck_ideal + 5; neck++) {
    if (neck % 2 === 0) continue; // neck is always odd -- see derivation below

    // Pre-raglan front/sleeve-base/back all derive from `neck` alone (spec Step C).
    // front is odd, sleeve-base is odd (funnel/neck-stage parity, spec §3), and
    // back = front +/- 1 (correction #1 above). Requiring
    //   neck = front + 2*sleeve_base + (back - 2)      [one-time back +2 = +1/half]
    // with back = front + offset (offset = +/-1) gives
    //   front + sleeve_base = (neck + 2 - offset) / 2
    // Since front and sleeve_base are both odd, their sum is even, which pins
    // offset to whichever sign makes (neck+2-offset)/2 an integer -- i.e. neck's
    // residue mod 4 (also why neck must be odd: two odd terms sum even).
    let offset, target_sum;
    if (neck % 4 === 3) { offset = 1; target_sum = (neck + 1) / 2; }
    else if (neck % 4 === 1) { offset = -1; target_sum = (neck + 3) / 2; }
    else continue;

    const f_pr = toOdd(round(target_sum * FRONT_FRAC));
    const s_pr_base = target_sum - f_pr;
    if (s_pr_base < 1 || s_pr_base % 2 === 0) continue;
    const b_pr = f_pr + offset; // pre-raglan back (one section); +1/half one-time increase already folded in
    if (b_pr < 2) continue;

    // Step C: one-time increase (18-30% of neck; back +1/half fixed, sleeve +odd each, front +0)
    const incLo = Math.ceil(neck * ONE_TIME_PCT[0]);
    const incHi = Math.floor(neck * ONE_TIME_PCT[1]);
    for (let inc = incLo; inc <= incHi; inc++) {
      if ((inc - 2) % 2 !== 0) continue;
      const sAdd = (inc - 2) / 2;
      if (sAdd < 1 || sAdd % 2 === 0) continue;
      const s_pr = s_pr_base + sAdd;

      // Step D: block solve
      for (let nlight = 0; nlight <= 1; nlight++) {
        for (let brow = BLOCK_ROWS[0]; brow <= BLOCK_ROWS[1]; brow++) {
          const nb = round(rows_target / brow);
          if (nb < 1) continue;
          const nfull = nb - nlight;
          if (nfull < 1) continue;

          const front_end  = f_pr + nfull * FULL_RATE.front  + nlight * LIGHT_RATE.front;
          const sleeve_end = s_pr + nfull * FULL_RATE.sleeve + nlight * LIGHT_RATE.sleeve;
          const back_end   = b_pr + nfull * FULL_RATE.back   + nlight * LIGHT_RATE.back;

          const row_err = Math.abs(nb - rows_target / brow);
          const block_height_err = Math.abs((brow * 10) / gr - BLOCK_HEIGHT_TARGET_CM);

          // UA is a fine-tuner chosen AFTER block growth (correction #3 above): it
          // doesn't affect front_end/back_end/sleeve_end at all.
          for (let UA = ua_lo; UA <= ua_hi; UA++) {
            if ((sleeve_end + UA) % 2 !== 0) continue; // post-UA sleeve even (spec §3)
            const SL_post = sleeve_end + UA;
            const B_post = front_end + back_end + 2 * UA;
            const fin_sleeve_cm = (SL_post * 2) / gs * 10;
            const fin_bust_cm = (B_post * 2) / gs * 10;
            const score =
              block_height_err * 1.0 +
              Math.abs(neck - neck_ideal) * 1.5 +
              Math.abs(fin_bust_cm - fin_bust) * 0.3 +
              Math.abs(fin_sleeve_cm - fin_arm) * 0.5 +
              row_err * 0.3;
            if (best === null || score < best.score) {
              best = {
                score, neck, inc, sAdd, f_pr, s_pr, b_pr, offset,
                nfull, nlight, brow, nb,
                front_end, back_end, sleeve_end,
                UA, SL_post, B_post, fin_bust_cm, fin_sleeve_cm,
              };
            }
          }
        }
      }
    }
  }

  if (best === null) {
    return { ok: false, error: "no_solution", inputs: { bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit } };
  }

  const b = best;
  const CO = b.neck + PRENECK_MARGIN_RIBS;
  const funnel_rows = toEven(round((FUNNEL_DEPTH_CM * gr) / 10));
  const preraglan_ribs = b.f_pr + b.b_pr + 2 * b.s_pr;
  const Y4_ribs = b.front_end + b.back_end + 2 * b.sleeve_end;

  // TDCR-style closure booleans -- hard-error (below) on any false.
  const closure_checks = {
    preraglan_front_odd: b.f_pr % 2 === 1,
    preraglan_sleeve_even: b.s_pr % 2 === 0,
    y4_front_odd: b.front_end % 2 === 1,
    y4_back_offset_by_one: Math.abs(b.back_end - b.front_end) === 1,
    sleeve_post_even: b.SL_post % 2 === 0,
  };

  const backHalf = Math.floor(b.b_pr / 2);
  const y4BackHalf = Math.floor(b.back_end / 2);

  // neck stage (before one-time increase): front unchanged (front+0 one-time), sleeve
  // base (before +sAdd), back total = b_pr - 2 (one-time increase was +1/half = +2 total).
  const neckBackHalf = (b.b_pr - 2) / 2;
  const s_neck = b.s_pr - b.sAdd;
  // pre-neck stage (before the reduction round): reduction removes front-1, sleeve-1/each
  // (spec Step E), so working backward, pre-neck = neck + those same amounts.
  const f_preneck = b.f_pr + 1;
  const s_preneck = s_neck + 1;
  const b_preneck_half = neckBackHalf;

  return {
    ok: true,
    CO_ribs: CO,
    CO_cm: round((CO * 2) / gs * 10 * 10) / 10,
    neck_ribs: b.neck,
    neck_cm: round((b.neck * 2) / gs * 10 * 10) / 10,
    distributions: {
      preneck: [b_preneck_half, s_preneck, f_preneck, s_preneck, b_preneck_half],
      neck: [neckBackHalf, s_neck, b.f_pr, s_neck, neckBackHalf],
      preraglan: [backHalf, b.s_pr, b.f_pr, b.s_pr, b.b_pr - backHalf],
      Y4: [y4BackHalf, b.sleeve_end, b.front_end, b.sleeve_end, b.back_end - y4BackHalf],
    },
    one_time_inc: b.inc,
    one_time_dist: { back_each_half: 1, sleeve_each: b.sAdd, front: 0 },
    preraglan_ribs,
    blocks: { full: b.nfull, light: b.nlight, rows_each: b.brow, n_blocks: b.nb },
    funnel_rows,
    Y4_ribs,
    Y4: {
      front: b.front_end, back: b.back_end, sleeve_preUA: b.sleeve_end, UA: b.UA,
      SL_post: b.SL_post, B_post: b.B_post,
      finished_bust_cm: Math.round(b.fin_bust_cm * 10) / 10,
      finished_sleeve_cm: Math.round(b.fin_sleeve_cm * 10) / 10,
    },
    closure_checks,
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

const NO2_ANCHOR = { CO_ribs: 38, neck_ribs: 35, preraglan_ribs: 43, one_time_inc: 8, Y4_ribs: 111 };
const NO2_TOLERANCE_RIBS = 2;

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
    return `<section class="result error">
      <h2>No solution found</h2>
      <p>No parity-valid combination was found for these inputs within the search
      space. Try adjusting armhole length, gauge, or fit.</p>
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
          anchor[field] = { target, achieved, gap, ok: gap <= NO2_TOLERANCE_RIBS };
          if (gap > NO2_TOLERANCE_RIBS) allOk = false;
        }
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

export { solve, HARNESS, NO2_ANCHOR, NO2_TOLERANCE_RIBS, validateInputs };
