"""
brioche_reference.py — known-good baseline for the brioche raglan calculator.
Solves Y4 (divide) UPWARD to CO. All counts in RIBS (1 rib = 2 sts).
This is a REFERENCE for the coder handoff; ship alongside brioche_build_spec.md.

Verified: reproduces No2 anchor; all 5 harness cases solve with valid parity.
"""
import math

# ---- constants (spec §2) ----
EASE = {"close": 2.5, "relaxed": 10.0}
SLEEVE_EASE_CM = 7
FUNNEL_DEPTH_CM = 8
PRENECK_MARGIN_RIBS = 3
NECK_RELAX_FACTOR = 1.10
ONE_TIME_PCT = (0.18, 0.30)
FULL_BLOCK_TOTAL = 8
LIGHT_BLOCK_TOTAL = 4
BLOCK_ROWS = (6, 14)
UA_MIN_CM = 2

# per-section growth per FULL block (spec §4): back = Lb+Rb as ONE section.
# sleeve +2, front +2, back +2 (all equal). sum over round = 2+2+2+2(two sleeves)=8.
FULL_RATE = {"back": 2, "sleeve": 2, "front": 2}
LIGHT_RATE = {"back": 1, "sleeve": 1, "front": 1}

def UA_max_cm(bust):
    return 8 if bust < 100 else 11 if bust < 120 else 14

def toOdd(n):  return n if n % 2 else n + 1
def toEven(n): return n + 1 if n % 2 else n

def solve(bust, arm, neck_cm, armhole_cm, gs, gr, fit, tol_ribs=1):
    cmToRibs = lambda cm: round(cm * gs / 10 / 2)
    fin_bust = bust + EASE[fit]
    fin_arm  = arm + SLEEVE_EASE_CM

    # Step B: Y4 windows
    sleeve_total = cmToRibs(fin_arm)                       # finished sleeve circ, ribs
    body_total   = cmToRibs(fin_bust)                      # finished bust, ribs
    ua_lo = max(2, math.floor(UA_MIN_CM * gs / 20))
    ua_hi = max(ua_lo, math.floor(UA_max_cm(bust) * gs / 20))

    neck_ideal = round((neck_cm / NECK_RELAX_FACTOR) * gs / 20)
    rows_target = armhole_cm * gr / 10

    best = None
    for UA in range(ua_lo, ua_hi + 1):
        sleeve_Y4 = sleeve_total - UA                      # pre-UA sleeve target
        if (sleeve_Y4 + UA) % 2: continue                  # post-UA sleeve even
        sleeve_Y4 = toOdd(sleeve_Y4) if (sleeve_Y4 % 2) else sleeve_Y4
        # body: front odd, back(one section) = front (B=F rule, both one-section counts equal)
        front_Y4 = toOdd(round((body_total - 2 * UA) / 2))
        back_Y4_one = front_Y4

        for neck in range(neck_ideal - 3, neck_ideal + 4):
            if neck < 6: continue
            for inc in range(math.ceil(neck * ONE_TIME_PCT[0]), math.floor(neck * ONE_TIME_PCT[1]) + 1):
                if (inc - 2) % 2: continue                 # back+1 each(=2) + sleeve split
                sAdd = (inc - 2) // 2
                if sAdd < 1 or sAdd % 2 == 0: continue     # sleeve += odd
                # pre-raglan sections (neck split ~ sample proportions); back = ONE section
                f_pr = toOdd(round(neck * 0.37))
                s_pr = toOdd(round(neck * 0.145)) + sAdd
                b_pr = neck - f_pr - 2 * (s_pr - sAdd) + 2   # back(one) = remainder + back inc(2)
                for nlight in (0, 1):
                    for brow in range(BLOCK_ROWS[0], BLOCK_ROWS[1] + 1):
                        nb = round(rows_target / brow)
                        if nb < 1: continue
                        nfull = nb - nlight
                        if nfull < 1: continue
                        gS = nfull * FULL_RATE["sleeve"] + nlight * LIGHT_RATE["sleeve"]
                        gF = nfull * FULL_RATE["front"]  + nlight * LIGHT_RATE["front"]
                        gB = nfull * FULL_RATE["back"]   + nlight * LIGHT_RATE["back"]
                        sleeve_end = s_pr + gS
                        front_end  = f_pr + gF
                        back_end   = b_pr + gB
                        if abs(sleeve_end - sleeve_Y4) > tol_ribs: continue
                        if abs(front_end - front_Y4) > tol_ribs + 1: continue
                        row_err = abs(round(rows_target / brow) - rows_target / brow)
                        body_only = (front_Y4 - front_end) + (back_Y4_one - back_end)
                        score = (abs(neck - neck_ideal) * 2 + abs(body_only) * 0.5 + row_err)
                        if best is None or score < best["score"]:
                            best = dict(score=score, UA=UA, neck=neck, inc=inc, sAdd=sAdd,
                                        f_pr=f_pr, s_pr=s_pr, b_pr=b_pr,
                                        nfull=nfull, nlight=nlight, brow=brow, nb=nb,
                                        sleeve_Y4=sleeve_Y4, front_Y4=front_Y4, back_Y4_one=back_Y4_one,
                                        body_only=body_only)
    if best is None:
        return None
    b = best
    CO = b["neck"] + PRENECK_MARGIN_RIBS
    funnel_rows = toEven(round(FUNNEL_DEPTH_CM * gr / 10))
    B_post = b["front_Y4"] + b["back_Y4_one"] + 2 * b["UA"]
    SL_post = b["sleeve_Y4"] + b["UA"]
    return dict(
        CO_ribs=CO, CO_cm=round(CO * 2 / gs * 10, 1),
        neck_ribs=b["neck"], neck_cm=round(b["neck"] * 2 / gs * 10, 1),
        one_time_inc=b["inc"], preraglan_ribs=b["f_pr"] + 2 * b["s_pr"] + 2 * b["b_pr"],
        blocks=f"{b['nfull']}F+{b['nlight']}L x{b['brow']}r", n_blocks=b["nb"],
        funnel_rows=funnel_rows,
        Y4_front=b["front_Y4"], Y4_back=b["back_Y4_one"], Y4_sleeve_preUA=b["sleeve_Y4"], UA=b["UA"],
        SL_post=SL_post, B_post=B_post,
        finished_bust_cm=round(B_post * 2 / gs * 10, 1),
        finished_sleeve_cm=round(SL_post * 2 / gs * 10, 1),
        body_only_ribs=b["body_only"],
        checks=dict(sleeve_post_even=(SL_post % 2 == 0),
                    front_odd=(b["front_Y4"] % 2 == 1),
                    B_eq_F=(b["front_Y4"] == b["back_Y4_one"])),
    )

HARNESS = {
    "No1": dict(bust=80, arm=28, neck_cm=50, armhole_cm=25,   gs=10,   gr=30, fit="close"),
    "No2": dict(bust=97, arm=33, neck_cm=56, armhole_cm=25.5, gs=13,   gr=37, fit="relaxed"),
    "No3": dict(bust=97, arm=35, neck_cm=56, armhole_cm=25.5, gs=12.5, gr=43, fit="relaxed"),
    "B":   dict(bust=76, arm=26, neck_cm=48, armhole_cm=22,   gs=8,    gr=26, fit="close"),
    "C":   dict(bust=122,arm=42, neck_cm=60, armhole_cm=28,   gs=20,   gr=48, fit="relaxed"),
}

if __name__ == "__main__":
    for name, args in HARNESS.items():
        r = solve(**args)
        if not r:
            print(f"{name}: NO SOLUTION"); continue
        print(f"{name}: CO{r['CO_ribs']}({r['CO_cm']}) neck{r['neck_ribs']}({r['neck_cm']}) "
              f"inc{r['one_time_inc']} pre{r['preraglan_ribs']} {r['blocks']} "
              f"F{r['Y4_front']}/S{r['Y4_sleeve_preUA']}/UA{r['UA']} "
              f"bust{r['finished_bust_cm']} slv{r['finished_sleeve_cm']} "
              f"bodyonly{r['body_only_ribs']} checks={all(r['checks'].values())}")
