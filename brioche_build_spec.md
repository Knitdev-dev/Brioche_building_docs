# Brioche Raglan Calculator — Build-Ready Spec (for coder handoff)

Implement `brioche-calculator.js` — a gauge-driven calculator for a top-down
circular brioche raglan sweater. Knitting is top-down, but the calculator
**solves Y4 (the divide) upward** to CO. All counts in **ribs** (1 rib = 2 sts).

This spec is the authority on construction logic. Do NOT invent knitting rules;
where something is marked OPEN, surface it rather than guessing.

---

## 0. Validation harness (build this first, run on every change)

Five cases (body measurements; ease added by calculator). Output must be sane
(±2 ribs / ±1–2 cm of intent), all parities valid, no "no solution".

| Case | bust | arm | neck | armhole | gauge sts×rows | fit | notes |
|---|---|---|---|---|---|---|---|
| No1 | 80 | 28 | 50 | 25 | 10×30 | close | real (knitted, worn) |
| No2 | 97 | 33 | 56 | 25.5 | 13×37 | relaxed | real (knitted); Y4=111 ribs |
| No3 | 97 | 35 | 56 | 25.5 | 12.5×43 | relaxed | live target; Y4≈108, bust≈108.8, slv≈41.6 |
| B | 76 | 26 | 48 | 22 | 8×26 | close | edge: small/chunky |
| C | 122 | 42 | 60 | 28 | 20×48 | relaxed | edge: large/fine |

Anchor (must reproduce closely): **No2** — CO 38, neck 35, pre-raglan 43,
one-time +8, 9 blocks×10 rows, Y4 111.

---

## 1. Inputs

`{ bust_cm, upper_arm_cm, neck_cm, armhole_cm, gauge_sts, gauge_rows, fit }`
- `fit` ∈ {close, relaxed}
- `gauge_sts` 8–20 (hard error outside)
- armhole_cm: from a per-size table (OPEN — see §7); for now an input.

---

## 2. Constants

```
RIB = 2
EASE = { close: 2.5, relaxed: 10 }     // bust ease cm
SLEEVE_EASE_CM = 7                      // both fits
FUNNEL_DEPTH_CM = 8
PRENECK_MARGIN_RIBS = 3                 // CO = neck + 3, removed at reduction round
NECK_RELAX_FACTOR = 1.10                // CO to unstretched; worn opening relaxes
ONE_TIME_PCT = [0.18, 0.30]            // one-time increase as fraction of neck
FULL_BLOCK_TOTAL_RIBS = 8              // per full raglan block
LIGHT_BLOCK_TOTAL_RIBS = 4            // per light block (max 1, last)
BLOCK_ROWS = [6, 14]                   // allowed rows per block
UA_MIN_CM = 2
UA_MAX_CM(bust) = bust<100 ? 8 : bust<120 ? 11 : 14
```

---

## 3. Parity rules (ALL in ribs)

- Funnel/neck stage: front odd, sleeves odd.
- Pre-raglan: front odd, **back = front (B=F)**, sleeves even.
- Y4 sleeve: **post-UA sleeve even** (pre-UA sleeve + UA share parity: odd+odd or even+even).
- Y4 body: front odd, B=F.

---

## 4. Per-section growth (VERIFIED against V7 total 111)

Sections: `[Lback, Lsleeve, Front, Rsleeve, Rback]` — but **Lback+Rback = ONE back**.
4 raglan lines at sleeve edges; each full block adds +8 ribs total, distributed
so that **every section grows equally at +2 per full block**:

| Section | +/full block |
|---|---|
| Front | +2 |
| Back (Lb+Rb together) | +2 |
| Sleeve (each) | +2 |
(round sum = front 2 + back 2 + two sleeves 4 = 8 ✓)

Light block: +1 to each section (sum 4).

Verified: V7 pre-raglan front13/back14/sleeve8 → Y4 front30/back31/sleeve25 = 111 ✓.

Chevron (front, blocks 4→last): net-zero internal shaping; does NOT change the
front's +2 growth. Chevron ramp is a rendering concern, not a count concern.

NOTE: an earlier draft mis-split the back into two independent +1 half-sections,
producing a false "back deficit". Backs are two halves of one section growing +2.

---

## 5. Solve order (Y4 → CO)

**Step A — finished targets**
```
fin_bust = bust + EASE[fit]
fin_arm  = upper_arm + SLEEVE_EASE_CM
```

**Step B — Y4 windows (each ±tolerance ~1–2 cm)**
```
sleeve_total_ribs = round(fin_arm * gs / 20)          // finished sleeve circ
UA range from UA_MIN_CM..UA_MAX_CM(bust) → ribs
sleeve_preUA_window = [sleeve_total - UA_max, sleeve_total - UA_min]

body_total_ribs = round(fin_bust * gs / 20)
front_target = toOdd(round((body_total_ribs - 2*UA)/2 wrt chosen UA))
back = front  (B=F)
```

**Step C — pre-raglan starts (from neck + one-time increase)**
```
neck_ideal = round( (neck_cm / NECK_RELAX_FACTOR) * gs / 20 )   // soft target
one_time ∈ [ceil(neck*0.18), floor(neck*0.30)]
   distributed: back +1 each half, sleeve +odd each, front +0
pre-raglan sections = neck sections + one_time distribution
```

**Step D — block solve (parallel, all sections at once)**
```
rows_target = armhole_cm * gr / 10
for block_rows in 6..14:
  n_blocks = round(rows_target / block_rows)
  for n_light in {0,1}:
    n_full = n_blocks - n_light
    grow each section by (n_full*fullRate + n_light*lightRate)
    check: sleeve_preUA ∈ sleeve_window  AND (sleeve_preUA+UA) even
           front ∈ front_window ; back ∈ back_window
           residual to bust target absorbed by UA (within its range) + body-only rounds
    score = |neck - neck_ideal|*w1 + |residual|*w2 + row_rounding_err
pick min score
```

**Step E — up to CO**
```
CO = neck + PRENECK_MARGIN_RIBS
funnel_rows = toEven(round(FUNNEL_DEPTH_CM * gr / 10))
reduction round removes 3 ribs (front -1, each sleeve -1) → neck stage
```

**Fine-tuners (freedom to hit targets within tolerance):**
UA (2–14cm/size), one-time % (18–30), block count/rows, body-only rounds,
neck (soft ±3 ribs).

---

## 6. Outputs

```
{ CO_ribs, neck_ribs, neck_cm,
  distributions: { preneck[5], neck[5], preraglan[5], Y4[5] },  // all parity-checked
  one_time_inc, one_time_dist,
  blocks: { full, light, rows_each, body_only_ribs },
  funnel_rows,
  Y4: { front, back, sleeve_preUA, UA, SL_post, B_post,
        finished_bust_cm, finished_sleeve_cm },
  closure_checks: { preraglan_parity, y4_parity, sleeve_post_even } // booleans, error if false
}
```

Emit TDCR-style closure booleans; hard-error on any false.

---

## 7. OPEN (surface, don't guess)

- **Tolerance tuning (not structural).** Growth model is now correct (§4, all
  sections +2). The reference prototype reproduces No1/No3 with low body-only,
  but the search tolerances still reject No2/B/C. This is search-window tuning,
  not a construction unknown — a coder should tune `tol_ribs`, the neck search
  range, and the sleeve-parity nudge until all 5 harness cases pass, using No2
  as the exact anchor (must land 9 blocks, pre-raglan 43, Y4 111).


- **Armhole-length table** per size (brioche-specific). Currently input/TDCR lookup.
- **Light-block section distribution** (sum=4) — exact per-section split unverified.
- **Sleeve below Y4**: motif repeats + plain rounds; **motif decreases (spec will change)**.
- **Body below Y4**: chevron repeats from sweater-length input; hem.
- **Cuff**: to be redesigned.
- **No1 one-time increase**: unknown (pre-raglan not recorded) — only No2 anchors the 18–30% band.
- Lookup tables (neck, upper-arm) per size — or derive from samples.

---

## 8. Do / Don't

- DO reproduce No2 as the correctness anchor.
- DO keep all parity in ribs; verify post-UA sleeve even.
- DO build the 5-case harness and run it every change.
- DON'T invent knitting rules for anything in §7 — flag it.
- DON'T let block growth be uniform +2/section — backs are +1 (see §4).
- DON'T treat neck as hard — it's a soft target; Y4 + parity win.
