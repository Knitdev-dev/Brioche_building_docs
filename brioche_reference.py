"""
brioche_reference.py — validated baseline for the brioche raglan calculator.
Solves Y4 (divide) UPWARD to CO. All counts in RIBS (1 rib = 2 sts).

This is the reference logic ported into brioche-calculator.js. Ship alongside
brioche_build_spec.md. Run `python3 brioche_reference.py` to execute the
spec §0 five-case harness.

--------------------------------------------------------------------------
CORRECTIONS vs the original reference / spec §7 open items, all verified
against brioche V7.docx (the actual knitted pattern -- primary source):

1. Pre-raglan / Y4 back parity is B = F+1 (or F-1), NOT "B = F" as spec §3
   and §4 state. V7's own text says it outright: "Principles for rib
   counts: F = odd No of ribs; B = F+1; sleeves = even No of ribs" (pre-
   raglan stage). Confirmed twice from the real stitch tables: pre-raglan
   back(one section, Lback+Rback)=14=front(13)+1; Y4 back=32=front(31)+1
   (division-row table). This is a MATHEMATICAL NECESSITY, not just an
   observation: Y4 total = front+back+2*sleeve, and 2*sleeve is always
   even, so whenever the Y4 total is odd (111 for No2), front+back must be
   odd, meaning front and back have different parities -- strict B=F is
   impossible whenever front is odd (a hard rule) and the Y4 total is odd.
   Because both front and back grow at the identical +2/block rate (full
   AND light blocks alike -- see #2), whatever offset exists at pre-raglan
   persists unchanged through Y4: it is a derived invariant, not a
   separately-tuned rule.

2. Light-block per-section split (spec §7 explicitly flags this as
   "unverified"). Real V7 (raglan increase 9, the light/last block) is
   front+2 / back+2 (one section) / sleeve+0 (each) -- NOT the spec's
   stated "+1 to each section". Verified by reproducing V7's exact
   division-row stitch table: pre-raglan (front13/sleeve8ea/back14) -> Y4
   (front31/sleeve24ea/back32) via 8 full blocks (+2/+2/+2 each) + 1 light
   block; only front+2/back+2/sleeve+0 reproduces this exactly. This also
   explains why front stays odd all the way from pre-raglan through Y4:
   every block (full or light) adds an EVEN number of ribs to front, so
   its parity never flips.

3. UA (underarm cast-on) does not drive the block-growth search. Blocks
   grow front/back/sleeve independent of UA -- UA stitches are cast on
   separately at the division round ("Cast on 8 stitches for underarm").
   The old reference conflated the UA choice with the sleeve growth
   target (forcing sleeve_end to land within ~1 rib of a UA-specific
   point target) and also floored UA at a literal 2 ribs regardless of
   gauge, which excludes valid small-UA solutions at finer gauges. Fixed:
   solve pre-raglan + blocks first (UA-independent) to get front_end/
   back_end/sleeve_end, THEN pick the best UA (within its cm-derived
   range) satisfying post-UA-sleeve-even parity and best matching
   finished bust/sleeve targets -- matching spec's own framing of UA as a
   "fine-tuner".

4. Block-row height search: rather than only minimizing the rounding
   error of n_blocks against the armhole-row target (which alone prefers
   larger block-row counts and does not reproduce either known real
   case), block height in CM is also scored against an empirical target
   (~2.75cm), derived from the two known real block heights: No2 (10
   rows @ gauge-rows 37 = 2.70cm/block) and No3 (12 rows @ gauge-rows 43
   = 2.79cm/block). This reproduces No2's real 9-block x 10-row structure
   exactly, and No3's 9-block x 12-row structure exactly.

--------------------------------------------------------------------------
KNOWN RESIDUAL GAP (surfaced, not hidden): with valid parity everywhere,
the No2 anchor is reproduced within 2 ribs on CO/neck/pre-raglan/Y4
(CO36 vs 38, neck33 vs 35, pre-raglan41 vs 43, Y4=109 vs 111), while
one_time_inc(+8) and the block structure (9 blocks x 10 rows) match
exactly. The gap traces to NECK_RELAX_FACTOR=1.10 (spec §2): it predicts
neck_ideal=33 for No2, while V7's real neck is 35 (implying an effective
factor of ~1.03-1.05 for that specific real, fresh-off-the-needles
sample -- handoff.md separately records "~1.07 (fresh)" for No2, itself
different from both). Given neck is explicitly a SOFT target (README:
"Neck is a soft target; Y4 targets + parity win") this is treated as
in-tolerance (spec §0 bar: "sane... +/-2 ribs / +/-1-2cm of intent") rather
than forced to hit bit-exact by hard-coding neck=35 into the search.
"""
import math

# ---- constants (spec §2) ----
EASE = {"close": 2.5, "relaxed": 10.0}
SLEEVE_EASE_CM = 7
FUNNEL_DEPTH_CM = 8
PRENECK_MARGIN_RIBS = 3
NECK_RELAX_FACTOR = 1.10
ONE_TIME_PCT = (0.18, 0.30)
BLOCK_ROWS = (6, 14)
UA_MIN_CM = 2
BLOCK_HEIGHT_TARGET_CM = 2.75  # empirical: No2 10r/gr37=2.70cm, No3 12r/gr43=2.79cm (see note 4 above)
FRONT_FRAC = 13 / 18           # empirical split of (front+sleeve-base) at neck stage, from V7 No2

# per-section growth (spec §4, corrected per note 2 above): back = Lb+Rb as ONE section.
FULL_RATE  = {"front": 2, "back": 2, "sleeve": 2}
LIGHT_RATE = {"front": 2, "back": 2, "sleeve": 0}

def UA_max_cm(bust):
    return 8 if bust < 100 else 11 if bust < 120 else 14

def toOdd(n):  return n if n % 2 else n + 1
def toEven(n): return n + 1 if n % 2 else n


def solve(bust, arm, neck_cm, armhole_cm, gs, gr, fit):
    """Solve Y4 (divide) upward to CO. Returns None if no valid/parity-clean
    combination is found anywhere in the search space (hard failure)."""
    cmToRibs = lambda cm: round(cm * gs / 10 / 2)
    fin_bust = bust + EASE[fit]
    fin_arm  = arm + SLEEVE_EASE_CM

    # Step B: Y4 windows
    sleeve_total = cmToRibs(fin_arm)
    body_total   = cmToRibs(fin_bust)
    ua_lo = max(1, round(UA_MIN_CM * gs / 20))
    ua_hi = max(ua_lo, math.floor(UA_max_cm(bust) * gs / 20))

    neck_ideal = round((neck_cm / NECK_RELAX_FACTOR) * gs / 20)
    rows_target = armhole_cm * gr / 10

    best = None
    for neck in range(max(7, neck_ideal - 4), neck_ideal + 5):
        if neck % 2 == 0:
            continue  # neck is always odd -- see derivation below
        # Pre-raglan front/sleeve-base/back all derive from `neck` alone (spec Step C).
        # front is odd, sleeve-base is odd (funnel/neck-stage parity, spec §3), and
        # back = front +/- 1 (note 1 above). Requiring
        #   neck = front + 2*sleeve_base + (back - 2)          [one-time back +2 = +1/half]
        # with back = front + offset (offset = +/-1) gives
        #   front + sleeve_base = (neck + 2 - offset) / 2
        # Since front and sleeve_base are both odd, their sum is even, which pins
        # offset to whichever sign makes (neck+2-offset)/2 an integer -- i.e. neck's
        # residue mod 4 (this is also why neck must be odd: both odd terms sum even,
        # and 2*even - offset must land back on neck).
        if neck % 4 == 3:
            offset, target_sum = 1, (neck + 1) // 2
        elif neck % 4 == 1:
            offset, target_sum = -1, (neck + 3) // 2
        else:
            continue
        f_pr = toOdd(round(target_sum * FRONT_FRAC))
        s_pr_base = target_sum - f_pr
        if s_pr_base < 1 or s_pr_base % 2 == 0:
            continue
        b_pr = f_pr + offset  # pre-raglan back (one section); +1/half one-time increase already folded in
        if b_pr < 2:
            continue

        # Step C: one-time increase (18-30% of neck; back +1/half fixed, sleeve +odd each, front +0)
        for inc in range(math.ceil(neck * ONE_TIME_PCT[0]), math.floor(neck * ONE_TIME_PCT[1]) + 1):
            if (inc - 2) % 2:
                continue
            sAdd = (inc - 2) // 2
            if sAdd < 1 or sAdd % 2 == 0:
                continue
            s_pr = s_pr_base + sAdd

            # Step D: block solve
            for nlight in (0, 1):
                for brow in range(BLOCK_ROWS[0], BLOCK_ROWS[1] + 1):
                    nb = round(rows_target / brow)
                    if nb < 1:
                        continue
                    nfull = nb - nlight
                    if nfull < 1:
                        continue

                    front_end  = f_pr + nfull * FULL_RATE["front"]  + nlight * LIGHT_RATE["front"]
                    sleeve_end = s_pr + nfull * FULL_RATE["sleeve"] + nlight * LIGHT_RATE["sleeve"]
                    back_end   = b_pr + nfull * FULL_RATE["back"]   + nlight * LIGHT_RATE["back"]

                    row_err = abs(nb - rows_target / brow)
                    block_height_err = abs(brow * 10 / gr - BLOCK_HEIGHT_TARGET_CM)

                    # UA is a fine-tuner chosen AFTER block growth (note 3 above), not a
                    # driver of it: it doesn't affect front_end/back_end/sleeve_end at all.
                    for UA in range(ua_lo, ua_hi + 1):
                        if (sleeve_end + UA) % 2:
                            continue  # post-UA sleeve even (spec §3)
                        SL_post = sleeve_end + UA
                        B_post  = front_end + back_end + 2 * UA
                        fin_sleeve_cm = SL_post * 2 / gs * 10
                        fin_bust_cm   = B_post * 2 / gs * 10
                        score = (block_height_err * 1.0
                                 + abs(neck - neck_ideal) * 1.5
                                 + abs(fin_bust_cm - fin_bust) * 0.3
                                 + abs(fin_sleeve_cm - fin_arm) * 0.5
                                 + row_err * 0.3)
                        if best is None or score < best["score"]:
                            best = dict(score=score, neck=neck, inc=inc, sAdd=sAdd,
                                        f_pr=f_pr, s_pr=s_pr, b_pr=b_pr, offset=offset,
                                        nfull=nfull, nlight=nlight, brow=brow, nb=nb,
                                        front_end=front_end, back_end=back_end, sleeve_end=sleeve_end,
                                        UA=UA, SL_post=SL_post, B_post=B_post,
                                        fin_bust_cm=fin_bust_cm, fin_sleeve_cm=fin_sleeve_cm)
    if best is None:
        return None
    b = best

    # Step E: up to CO
    CO = b["neck"] + PRENECK_MARGIN_RIBS
    funnel_rows = toEven(round(FUNNEL_DEPTH_CM * gr / 10))
    preraglan_ribs = b["f_pr"] + b["b_pr"] + 2 * b["s_pr"]
    Y4_ribs = b["front_end"] + b["back_end"] + 2 * b["sleeve_end"]

    # neck stage (before one-time increase): front unchanged (front+0 one-time), sleeve
    # base (before +sAdd), back total = b_pr - 2 (one-time increase was +1/half = +2 total).
    neck_back_half = (b["b_pr"] - 2) // 2
    s_neck = b["s_pr"] - b["sAdd"]
    # pre-neck stage (before the reduction round): reduction removes front-1, sleeve-1/each
    # (spec Step E), so working backward, pre-neck = neck + those same amounts.
    f_preneck = b["f_pr"] + 1
    s_preneck = s_neck + 1
    b_preneck_half = neck_back_half

    checks = dict(
        preraglan_front_odd=(b["f_pr"] % 2 == 1),
        preraglan_sleeve_even=(b["s_pr"] % 2 == 0),
        y4_front_odd=(b["front_end"] % 2 == 1),
        y4_back_offset_by_one=(abs(b["back_end"] - b["front_end"]) == 1),
        sleeve_post_even=(b["SL_post"] % 2 == 0),
    )
    return dict(
        CO_ribs=CO, CO_cm=round(CO * 2 / gs * 10, 1),
        neck_ribs=b["neck"], neck_cm=round(b["neck"] * 2 / gs * 10, 1),
        distributions=dict(
            preneck=[b_preneck_half, s_preneck, f_preneck, s_preneck, b_preneck_half],
            neck=[neck_back_half, s_neck, b["f_pr"], s_neck, neck_back_half],
            preraglan=[b["b_pr"] // 2, b["s_pr"], b["f_pr"], b["s_pr"], b["b_pr"] - b["b_pr"] // 2],
            Y4=[b["back_end"] // 2, b["sleeve_end"], b["front_end"], b["sleeve_end"], b["back_end"] - b["back_end"] // 2],
        ),
        one_time_inc=b["inc"], preraglan_ribs=preraglan_ribs,
        blocks=dict(full=b["nfull"], light=b["nlight"], rows_each=b["brow"], n_blocks=b["nb"]),
        funnel_rows=funnel_rows,
        Y4_ribs=Y4_ribs,
        Y4=dict(front=b["front_end"], back=b["back_end"], sleeve_preUA=b["sleeve_end"], UA=b["UA"],
                SL_post=b["SL_post"], B_post=b["B_post"],
                finished_bust_cm=round(b["fin_bust_cm"], 1),
                finished_sleeve_cm=round(b["fin_sleeve_cm"], 1)),
        closure_checks=checks,
    )


HARNESS = {
    "No1": dict(bust=80,  arm=28, neck_cm=50, armhole_cm=25,   gs=10,   gr=30, fit="close"),
    "No2": dict(bust=97,  arm=33, neck_cm=56, armhole_cm=25.5, gs=13,   gr=37, fit="relaxed"),
    "No3": dict(bust=97,  arm=35, neck_cm=56, armhole_cm=25.5, gs=12.5, gr=43, fit="relaxed"),
    "B":   dict(bust=76,  arm=26, neck_cm=48, armhole_cm=22,   gs=8,    gr=26, fit="close"),
    "C":   dict(bust=122, arm=42, neck_cm=60, armhole_cm=28,   gs=20,   gr=48, fit="relaxed"),
}

# No2 anchor targets (spec §0 / README) -- checked with slack, see "KNOWN RESIDUAL GAP" above.
NO2_ANCHOR = dict(CO_ribs=38, neck_ribs=35, preraglan_ribs=43, one_time_inc=8, Y4_ribs=111)
NO2_TOLERANCE_RIBS = 2


def run_harness(verbose=True):
    all_ok = True
    for name, args in HARNESS.items():
        r = solve(**args)
        if not r:
            all_ok = False
            if verbose:
                print(f"{name}: NO SOLUTION")
            continue

        closure_ok = all(r["closure_checks"].values())
        all_ok = all_ok and closure_ok
        if not closure_ok:
            raise RuntimeError(f"{name}: closure/parity check failed: {r['closure_checks']}")

        if verbose:
            blk = r["blocks"]
            y4 = r["Y4"]
            print(f"{name}: CO{r['CO_ribs']}({r['CO_cm']}cm) neck{r['neck_ribs']}({r['neck_cm']}cm) "
                  f"inc{r['one_time_inc']} pre{r['preraglan_ribs']} "
                  f"{blk['full']}F+{blk['light']}L x{blk['rows_each']}r Y4tot{r['Y4_ribs']} "
                  f"F{y4['front']}/B{y4['back']}/S{y4['sleeve_preUA']}/UA{y4['UA']} "
                  f"bust{y4['finished_bust_cm']}cm slv{y4['finished_sleeve_cm']}cm "
                  f"checks={closure_ok}")

        if name == "No2":
            for field, target in NO2_ANCHOR.items():
                achieved = r[field]
                gap = abs(achieved - target)
                status = "OK" if gap <= NO2_TOLERANCE_RIBS else "OUT OF TOLERANCE"
                if verbose:
                    print(f"      anchor check {field}: target={target} achieved={achieved} gap={gap} [{status}]")
                if gap > NO2_TOLERANCE_RIBS:
                    all_ok = False
    return all_ok


if __name__ == "__main__":
    ok = run_harness()
    print(f"\nHARNESS {'PASSED' if ok else 'FAILED'}")
