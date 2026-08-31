# Brioche Calculator — Handoff

## What we're doing
Building a gauge-driven calculator for a **top-down circular brioche raglan** sweater
(funnel neck, chevron front, motif sleeve), modeled on the TDCR pipeline.
Counts in **ribs** (1 rib = 2 sts). All parity rules are in ribs.

## What we've done
- Locked construction, constants, and fit model (**close 2.5 cm / relaxed 10 cm** bust ease; **sleeve ease 7 cm** both).
- Established that the algorithm **solves from Y4 (divide) upward**, TDCR-style.
- Built + validated the **CO→Y4 yoke solver** (`brioche-calculator-yoke.js`) against hand calc for No 3.
- Derived the **one-time increase** as 18–30% of neck (tuning knob), distributed back +1 each / sleeve +odd each / front +0.
- Resolved the **width-vs-length tension**: blocks solve width; **block row-height (10–14) + body-only rounds** solve length.
- Captured full CO→Y4 for No 1, No 2, No 3.

## Still to do (below Y4)
- Sleeve: motif repeats + plain rounds; **motif decreases (spec will change)**.
- Body: chevron repeats from sweater-length input; hem.
- Cuff (to be redesigned).
- **Armhole-length table** per size (currently using TDCR lookup).
- Lookup tables (neck, upper-arm, armhole) per size — or derive from samples.
- No 3 live knit to confirm sleeve ease.

---

## Canonical inputs (BODY measurements — what the calculator takes)

These are the harness inputs. Ease is added by the calculator (close +2.5, relaxed +10 bust; +7 sleeve). Do not confuse with realized rib counts below.

| Case | bust | arm | neck | armhole | gauge | fit |
|---|---|---|---|---|---|---|
| No 1 | 80 | 28 | 50 | 25 | 10×30 | close |
| No 2 | 97 | 33 | 56 | 25.5 | 13×37 | relaxed |
| No 3 | 97 | 35 | 56 | 25.5 | 12.5×43 | relaxed |
| B | 76 | 26 | 48 | 22 | 8×26 | close |
| C | 122 | 42 | 60 | 28 | 20×48 | relaxed |

(B, C = synthetic edge cases for the harness, not real garments.)

---

## Realized rib counts (measured off ACTUAL knitted garments)

## No 1 (size M, close, worn) — gauge 10 × 30
| Measure | ribs | sts | cm |
|---|---|---|---|
| Neck (after reduction) | 23 | 46 | 46 (worn-stretched to 56) |
| Bust / Y4 (body) | 42 | 84 | 84 (front even = ERROR, should be odd) |
| Upper arm | 19 | 38 | 38 (measured 33) |
| Cuff | 11 | 22 | 22 |
- Funnel 8 cm · yoke depth 25 cm · body length 70.5 cm (incl. 11 cm hem)
- Neck stretch factor ~1.22 (worn-in)

## No 2 (V7, relaxed) — gauge 13 × 37 (garment-derived)
| Measure | ribs | sts | cm |
|---|---|---|---|
| CO | 38 | 76 | 58.5 |
| Neck (after −3) | 35 | 70 | 53.8 |
| Pre-raglan | 43 | 86 | 66.2 |
| Y4 | 111 | 222 | 170.8 (full yoke circ) |
- Funnel 8 cm · one-time +8 · 9 blocks × 10 rows
- Neck stretch factor ~1.07 (fresh)

## No 3 (calc, relaxed, your size) — gauge 12.5 × 43
Inputs: bust 97, upper arm 35, neck 56, armhole 25.5 (TDCR lookup)

| Stage | ribs | sts | cm |
|---|---|---|---|
| CO | 33 | 66 | 52.8 |
| Neck (after −3) | 30 | 60 | 48.0 |
| Pre-raglan (one-time +8) | 38 | 76 | 60.8 |
| Y4 (9 blocks × 12 rows) | 108 | 216 | (sections below) |

Y4 sections (pre-UA): front 31 · back 31 · sleeve 23 each
UA 3 ribs → **SL** 26 ribs (52 sts, 41.6 cm) · **B** 68 ribs (136 sts, **108.8 cm**)
Funnel 34 rows · yoke 108 rows (25.1 cm)
One-time dist: back +1 each, sleeve +3 each, front +0
Note: blocks overshoot by 2 ribs → 1 body-only decrease or accept +bust.

---

## Assumptions (all)
1. 1 rib = 2 sts; every odd/even rule is in ribs.
2. Fits: close = 2.5 cm, relaxed = 10 cm bust ease. Sleeve ease 7 cm both.
3. Funnel depth fixed 8 cm.
4. Pre-neck margin +3 ribs (removed at reduction round).
5. Parity: funnel stage front odd / sleeves odd; pre-raglan front odd / **B = F** / sleeves even.
6. One-time increase = 18–30% of neck (solver tunes within range); back +1 each, sleeve +odd each, front +0.
7. Neck relax factor 1.15 (CO to unstretched; worn opening relaxes).
8. Full block +16 sts (8 ribs); light block +8 sts (4 ribs), max 1, last.
9. Block row-height variable 10–14 rows (solver picks); body-only rounds absorb ±residual.
10. Armhole length from TDCR lookup for now (brioche table pending).
11. UA (underarm CO) = fraction (0.08–0.22, grows with bust) × finished upper-arm cm, TDCR-style.
12. Solve direction: Y4 targets (bust+ease, arm+ease) → work upward to CO.
13. Body B = F (front = back), front odd. (Changed from B = F+1.)
14. Garment-derived gauge trusted over flat swatch for No 2.
15. No 2 and No 3 are different yarns; no gauge inheritance.
16. Short rows: none (funnel worked straight) — TDCR short-row steps deleted.
