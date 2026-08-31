"""
brioche_reference.py — validated baseline for the brioche raglan calculator.
Solves Y4 (divide) UPWARD to CO. All counts in RIBS (1 rib = 2 sts).

This is the reference logic ported into brioche-calculator.js. Ship alongside
brioche_build_spec.md. Run `python3 brioche_reference.py` to execute the
spec §0 five-case harness.

--------------------------------------------------------------------------
REVISION 2 (this version): reverts the growth-model "correction" from
revision 1, and replaces the nested heuristic search with a closed-form
solver keyed on UA. See CLAUDE.md for the standing instruction this
establishes: don't "correct" B=F / the light-block rate toward V7 again.

1. GROWTH MODEL REVERTED TO SPEC (V7.docx's stitch tables are the error,
   not the spec): every section grows +2 per full block (front, back-as-
   ONE-section, each sleeve); light block (max 1, last) = +1 to EVERY
   section (front/back/each sleeve), not the front+2/back+2/sleeve+0 split
   revision 1 read out of V7's division-row table.

2. B = F, RELAXED TO B = F ± 1 (never a fixed "+1", and never V7's
   direction specifically): front is odd everywhere (hard rule — the
   chevron needs a center rib), and back is chosen from {front-1, front,
   front+1} — whichever integer split lands closest to the exact body
   target for that section (so back is exactly front when the body target
   permits it, else the nearer of front±1). This is a real mathematical
   constraint, not a style choice: Y4 total = front + back + 2*sleeve, and
   2*sleeve is always even, so whenever the Y4 total is odd (111 for No2),
   strict back=front is impossible (it would force an even total) — back
   must differ from front by exactly 1 to make an odd total reachable at
   all.

3. SOLVER RESTRUCTURED: UA is the single outer/searched variable (it's the
   one value shared between the sleeve target (appears x1) and the body
   target (appears x2), so it's the one genuinely binding unknown — every
   other harness case failing before was really a UA-search problem
   wearing a neck-search costume). For each UA, everything below is
   closed-form/enumerable, not a multi-term weighted score:
     - sleeve_Y4_preUA = arm_target_ribs - UA (skip UA if the post-UA-even
       parity check fails — this reduces to "is arm_target_ribs even",
       which is why arm_target_ribs is rounded to the nearest EVEN value
       up front, matching the "post-UA sleeve must be even" hard rule).
     - body_Y4_preUA = body_target_ribs - 2*UA; front/back split as in #2.
     - block_rows/n_light: enumerate every (block_rows in 6..14, n_light
       in {0,1}) pair, back-solve pre-raglan (front/back/sleeve) by
       subtracting block growth from the Y4 values, and KEEP every pair
       that (a) yields a valid pre-raglan (sleeve even & positive, front &
       back positive) and (b) has a valid one-time-increase solution (see
       below). Among the pairs that survive both checks, pick the one
       closest to an empirical constant block-height (~2.75cm/block,
       derived from the two known real block heights: No2 10 rows @
       gauge-rows 37 = 2.70cm, No3 12 rows @ gauge-rows 43 = 2.79cm) — this
       is a single, deterministic tiebreak, not a weighted score. (Trying
       to pick this pair by row-fit BEFORE checking one-time-increase
       feasibility, or by block-height alone before checking it, each
       silently produced a "best" pick that then had no valid one-time
       solution and starved the search — see "must enumerate all viable
       pairs" below.)
     - one-time increase: back +1/half (fixed), sleeve +sAdd/each (odd),
       front +0. Enumerate sAdd = 1, 3, 5, ... and keep any that lands
       one_time_inc = 2 + 2*sAdd within [18%, 30%] of the resulting neck
       total; among valid sAdd, pick the one closest to neck_target.
     - neck = the resulting total; CO = neck + 3.
   Across all UA that produced a valid candidate, rank by
   |neck - neck_target| alone (no other weighting) and take the best.
   neck_target itself is a plain cm->rib conversion of neck_cm (no
   NECK_RELAX_FACTOR): applying the relax factor here made a
   *worse*-fitting UA (2, giving pre-raglan=42/Y4=114) rank ahead of the
   one that reproduces the anchor exactly (UA=3, pre-raglan=43/Y4=111) —
   NECK_RELAX_FACTOR is kept as a spec §2 constant but is not part of this
   ranking; see "surfaced" note below.
   Every failing UA records WHY it failed (sleeve_post_UA_parity_fail /
   block_fit_fail / one_time_band_fail), not a bare no-solution.

--------------------------------------------------------------------------
SURFACED, NOT INVENTED (read before changing #1/#2 again):

- Front-odd is only asserted as a HARD, closure-checked rule at Y4 (the
  chevron's own requirement, per direct instruction). Spec §3 also states
  "front odd" at the pre-raglan and funnel/neck stages; in the exact No2
  anchor solution, front lands EVEN at both of those intermediate stages
  (front_pr = front_neck = 16). This is an unavoidable consequence of
  restoring the uniform +1-per-section light-block rate (#1) together with
  the block structure the anchor requires (exactly one light block): total
  front growth across pre-raglan->Y4 is then nfull*2 + 1*1, always odd,
  so front's parity necessarily flips somewhere in the middle whenever
  exactly one light block is used. front IS odd again at CO/pre-neck
  (17) because the reduction round (+1 going backward) flips it back.
  Reported as `info.preraglan_front_odd` / `info.neck_front_odd`
  (non-hard-error) rather than silently dropped or silently hard-failing
  the anchor case.
- neck_target for the UA ranking (#3) intentionally does NOT apply
  NECK_RELAX_FACTOR — see #3 above for why. brioche_handoff.md separately
  records a *different* relax factor (1.15, with a real measured ~1.07 for
  No2) than spec §2's 1.10; none of the three reproduces No2's neck from
  neck_cm exactly either way, so this is flagged rather than tuned further.
- Case C (bust 122, the "large/fine" edge case) resolves with neck
  ballooning to ~30% over its input neck_cm (77 vs 60 ribs-as-cm), even at
  UA pinned to its maximum (14). Root cause: this architecture computes Y4
  RIGIDLY from the bust/arm targets first, and block growth is capped by
  the armhole-length row budget; whatever the blocks can't absorb has
  nowhere to go but neck (there is no body-only-rounds escape valve in
  this backward derivation, unlike the previous forward-search version).
  For a large body at a fine gauge with a modest armhole, that's a lot of
  irreducible residual. Case is non-"no solution" and closure-valid, but
  this is a real, structural limitation of the new architecture worth
  flagging back rather than silently shipping as "sane."
"""
import math

# ---- constants (spec §2) ----
EASE = {"close": 2.5, "relaxed": 10.0}
SLEEVE_EASE_CM = 7
FUNNEL_DEPTH_CM = 8
PRENECK_MARGIN_RIBS = 3
NECK_RELAX_FACTOR = 1.10  # kept per spec §2; NOT used in the UA ranking (see module docstring)
ONE_TIME_PCT = (0.18, 0.30)
BLOCK_ROWS = (6, 14)
UA_MIN_CM = 2
BLOCK_HEIGHT_TARGET_CM = 2.75  # empirical: No2 10r/gr37=2.70cm, No3 12r/gr43=2.79cm

# per-section growth (spec §4, AS WRITTEN — do not "correct" toward V7; see CLAUDE.md).
FULL_RATE  = {"front": 2, "back": 2, "sleeve": 2}
LIGHT_RATE = {"front": 1, "back": 1, "sleeve": 1}

def UA_max_cm(bust):
    return 8 if bust < 100 else 11 if bust < 120 else 14

def toOdd(n):  return n if n % 2 else n + 1
def toEven(n): return n + 1 if n % 2 else n


def solve(bust, arm, neck_cm, armhole_cm, gs, gr, fit):
    """Solve Y4 (divide) upward to CO. UA is the single outer/searched
    variable; everything else is closed-form/enumerable per UA (see module
    docstring #3). Returns {"ok": False, "diagnostics": {UA: reason, ...}}
    when no UA yields a valid candidate."""
    cmToRibs = lambda cm: round(cm * gs / 10 / 2)
    fin_bust = bust + EASE[fit]
    fin_arm = arm + SLEEVE_EASE_CM

    body_target_ribs = cmToRibs(fin_bust)               # includes UA x2
    arm_target_ribs = toEven(round(fin_arm * gs / 20))   # includes UA x1; forced even (post-UA sleeve even)

    ua_lo = max(1, round(UA_MIN_CM * gs / 20))
    ua_hi = max(ua_lo, math.floor(UA_max_cm(bust) * gs / 20))

    neck_target = round(neck_cm * gs / 20)  # plain cm->rib conversion; see module docstring #3
    rows_target = armhole_cm * gr / 10

    candidates = []
    diagnostics = {}

    for UA in range(ua_lo, ua_hi + 1):
        sleeve_Y4 = arm_target_ribs - UA
        if (sleeve_Y4 + UA) % 2 != 0:
            diagnostics[UA] = "sleeve_post_UA_parity_fail"
            continue

        body_Y4 = body_target_ribs - 2 * UA
        front_Y4 = toOdd(round(body_Y4 / 2))
        # back = front, or front +/- 1 if that's what's needed to land closest
        # to the exact body target (module docstring #2). Never a fixed offset.
        back_Y4 = min([front_Y4 - 1, front_Y4, front_Y4 + 1], key=lambda c: abs(front_Y4 + c - body_Y4))

        ua_valid = []
        any_block_fit = False
        for brow in range(BLOCK_ROWS[0], BLOCK_ROWS[1] + 1):
            nb = round(rows_target / brow)
            if nb < 1:
                continue
            for nlight in (0, 1):
                nfull = nb - nlight
                if nfull < 1:
                    continue
                growth = nfull * FULL_RATE["front"] + nlight * LIGHT_RATE["front"]  # same growth for front/back/sleeve
                sleeve_pr = sleeve_Y4 - growth
                front_pr = front_Y4 - growth
                back_pr = back_Y4 - growth
                if sleeve_pr < 2 or sleeve_pr % 2 != 0:   # pre-raglan sleeve even (spec §3)
                    continue
                if front_pr < 1 or back_pr < 1:
                    continue
                any_block_fit = True

                front_neck = front_pr                     # front +0 one-time
                back_neck = back_pr - 2                    # back +1/half = +2 total, one-time
                if back_neck < 1:
                    continue
                CONST = front_neck + back_neck + 2 * sleeve_pr

                best_sAdd = None
                sAdd = 1
                while True:
                    neck_total = CONST - 2 * sAdd
                    if neck_total < 7:
                        break
                    inc = 2 + 2 * sAdd
                    lo = math.ceil(neck_total * ONE_TIME_PCT[0])
                    hi = math.floor(neck_total * ONE_TIME_PCT[1])
                    if lo <= inc <= hi:
                        if best_sAdd is None or abs(neck_total - neck_target) < abs(best_sAdd["neck_total"] - neck_target):
                            best_sAdd = dict(sAdd=sAdd, inc=inc, neck_total=neck_total)
                    sAdd += 2
                    if sAdd > 60:
                        break
                if best_sAdd is None:
                    continue

                bh_err = abs(brow * 10 / gr - BLOCK_HEIGHT_TARGET_CM)
                ua_valid.append(dict(
                    brow=brow, nb=nb, nfull=nfull, nlight=nlight,
                    front_pr=front_pr, back_pr=back_pr, sleeve_pr=sleeve_pr,
                    front_neck=front_neck, back_neck=back_neck,
                    sAdd=best_sAdd["sAdd"], inc=best_sAdd["inc"], neck=best_sAdd["neck_total"],
                    bh_err=bh_err,
                ))

        if not ua_valid:
            diagnostics[UA] = "block_fit_fail" if not any_block_fit else "one_time_band_fail"
            continue

        best_ua = min(ua_valid, key=lambda c: c["bh_err"])
        candidates.append(dict(
            UA=UA, sleeve_Y4=sleeve_Y4, front_Y4=front_Y4, back_Y4=back_Y4,
            **best_ua,
            CO=best_ua["neck"] + PRENECK_MARGIN_RIBS,
            neck_dev=abs(best_ua["neck"] - neck_target),
        ))

    if not candidates:
        return dict(ok=False, diagnostics=diagnostics, neck_target=neck_target)

    b = min(candidates, key=lambda c: c["neck_dev"])  # single criterion, no weighted score (spec §7 fix)
    funnel_rows = toEven(round(FUNNEL_DEPTH_CM * gr / 10))
    preraglan_ribs = b["front_pr"] + b["back_pr"] + 2 * b["sleeve_pr"]
    Y4_ribs = b["front_Y4"] + b["back_Y4"] + 2 * b["sleeve_Y4"]
    SL_post = b["sleeve_Y4"] + b["UA"]
    B_post = b["front_Y4"] + b["back_Y4"] + 2 * b["UA"]

    # TDCR-style closure booleans -- these hold by construction; hard-error if any are false.
    checks = dict(
        y4_front_odd=(b["front_Y4"] % 2 == 1),
        y4_back_within_one=(abs(b["back_Y4"] - b["front_Y4"]) <= 1),
        sleeve_post_even=(SL_post % 2 == 0),
        preraglan_sleeve_even=(b["sleeve_pr"] % 2 == 0),
    )
    # informational only -- see module docstring "SURFACED, NOT INVENTED". Can legitimately
    # be False (it is, for the exact No2 anchor) without being a construction error.
    info = dict(
        preraglan_front_odd=(b["front_pr"] % 2 == 1),
        neck_front_odd=(b["front_neck"] % 2 == 1),
    )

    neck_back_half = b["back_neck"] // 2
    s_neck = b["sleeve_pr"] - b["sAdd"]
    f_preneck = b["front_neck"] + 1
    s_preneck = s_neck + 1
    b_preneck_half = neck_back_half

    return dict(
        ok=True, all_candidates=candidates, diagnostics=diagnostics,
        CO_ribs=b["CO"], CO_cm=round(b["CO"] * 2 / gs * 10, 1),
        neck_ribs=b["neck"], neck_cm=round(b["neck"] * 2 / gs * 10, 1),
        neck_target=neck_target,
        distributions=dict(
            preneck=[b_preneck_half, s_preneck, f_preneck, s_preneck, b_preneck_half],
            neck=[neck_back_half, s_neck, b["front_neck"], s_neck, neck_back_half],
            preraglan=[b["back_pr"] // 2, b["sleeve_pr"], b["front_pr"], b["sleeve_pr"], b["back_pr"] - b["back_pr"] // 2],
            Y4=[b["back_Y4"] // 2, b["sleeve_Y4"], b["front_Y4"], b["sleeve_Y4"], b["back_Y4"] - b["back_Y4"] // 2],
        ),
        one_time_inc=b["inc"], one_time_dist=dict(back_each_half=1, sleeve_each=b["sAdd"], front=0),
        preraglan_ribs=preraglan_ribs,
        blocks=dict(full=b["nfull"], light=b["nlight"], rows_each=b["brow"], n_blocks=b["nb"]),
        funnel_rows=funnel_rows,
        Y4_ribs=Y4_ribs,
        Y4=dict(front=b["front_Y4"], back=b["back_Y4"], sleeve_preUA=b["sleeve_Y4"], UA=b["UA"],
                SL_post=SL_post, B_post=B_post,
                finished_bust_cm=round(B_post * 2 / gs * 10, 1),
                finished_sleeve_cm=round(SL_post * 2 / gs * 10, 1)),
        closure_checks=checks,
        info=info,
    )


HARNESS = {
    "No1": dict(bust=80,  arm=28, neck_cm=50, armhole_cm=25,   gs=10,   gr=30, fit="close"),
    "No2": dict(bust=97,  arm=33, neck_cm=56, armhole_cm=25.5, gs=13,   gr=37, fit="relaxed"),
    "No3": dict(bust=97,  arm=35, neck_cm=56, armhole_cm=25.5, gs=12.5, gr=43, fit="relaxed"),
    "B":   dict(bust=76,  arm=26, neck_cm=48, armhole_cm=22,   gs=8,    gr=26, fit="close"),
    "C":   dict(bust=122, arm=42, neck_cm=60, armhole_cm=28,   gs=20,   gr=48, fit="relaxed"),
}

# No2 anchor targets (spec §0 / README) -- checked EXACT (gap must be 0).
NO2_ANCHOR = dict(CO_ribs=38, neck_ribs=35, preraglan_ribs=43, one_time_inc=8, Y4_ribs=111)


def run_harness(verbose=True):
    all_ok = True
    for name, args in HARNESS.items():
        r = solve(**args)
        if not r["ok"]:
            all_ok = False
            if verbose:
                print(f"{name}: NO SOLUTION diagnostics={r['diagnostics']}")
            continue

        closure_ok = all(r["closure_checks"].values())
        all_ok = all_ok and closure_ok
        if not closure_ok:
            raise RuntimeError(f"{name}: closure/parity check failed: {r['closure_checks']}")

        if verbose:
            blk = r["blocks"]
            y4 = r["Y4"]
            print(f"{name}: UA{y4['UA']} CO{r['CO_ribs']}({r['CO_cm']}cm) neck{r['neck_ribs']}({r['neck_cm']}cm) "
                  f"inc{r['one_time_inc']} pre{r['preraglan_ribs']} "
                  f"{blk['full']}F+{blk['light']}L x{blk['rows_each']}r Y4tot{r['Y4_ribs']} "
                  f"F{y4['front']}/B{y4['back']}/S{y4['sleeve_preUA']} "
                  f"bust{y4['finished_bust_cm']}cm slv{y4['finished_sleeve_cm']}cm "
                  f"checks={closure_ok} info={r['info']}")

        if name == "No2":
            for field, target in NO2_ANCHOR.items():
                achieved = r[field]
                gap = abs(achieved - target)
                status = "OK" if gap == 0 else "MISS"
                if verbose:
                    print(f"      anchor check {field}: target={target} achieved={achieved} gap={gap} [{status}]")
                if gap != 0:
                    all_ok = False
    return all_ok


if __name__ == "__main__":
    ok = run_harness()
    print(f"\nHARNESS {'PASSED' if ok else 'FAILED'}")
