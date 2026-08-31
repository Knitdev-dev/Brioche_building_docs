# Brioche_building_docs
Documents for building a brioche calculator and pattern template
# Brioche Raglan Calculator

Gauge-driven calculator for a top-down circular **brioche raglan** sweater
(funnel neck, chevron front, motif sleeve). Sister project to the TDCR pipeline;
same architecture (calculator owns all calculation + rendering).

## Start here

1. Read **`brioche_build_spec.md`** — it is the authority on construction logic.
2. Build the **§0 five-case harness first**, then run it on every change.
3. **No 2 is the correctness anchor** — your output must reproduce it closely:
   CO 38, neck 35, pre-raglan 43, one-time +8, 9 blocks × 10 rows, Y4 111 ribs.
4. `brioche_reference.py` is a known-good baseline (structurally correct growth
   model; reproduces No1/No3). Its search tolerances still reject No2/B/C —
   finishing that tuning is the first coding task (spec §7).

## Hard rules (these caused real bugs when violated)

- **Everything is in RIBS** (1 rib = 2 sts). All parity is rib-parity.
- **All sections grow +2 per full block** — front, back (Lb+Rb as ONE section),
  and each sleeve. Do NOT split the back into two +1 half-sections (that was a
  bug — see spec §4).
- **Solve Y4 (divide) UPWARD to CO**, even though knitting is top-down.
- **Neck is a soft target**; Y4 targets + parity win.
- **Post-UA sleeve must be even.**
- **Never invent knitting rules for spec §7 (OPEN) items — surface them.**

## Source of truth

- `brioche_build_spec.md` — build spec (start here)
- `brioche_reference.py` — known-good baseline + harness
- V7 draft pattern — the ACTUAL pattern; verify construction against it, not just the spec
- Handoff doc — No 1 / No 2 / No 3 measurements and gauges
- TDCR calculator — architectural model to mirror (short rows & Bresenham do NOT apply to brioche)

## Deliverable

`brioche-calculator.js` — Cloudflare Worker, owns all calculation + HTML rendering.
Emit TDCR-style closure booleans; hard-error on any parity/closure failure.
Validate against the full harness before any handover.

## Still to build below Y4 (spec §7)

Sleeve (motif repeats + plain rounds; decreases spec will change), body (chevron
repeats from sweater-length input; hem), cuff (to be redesigned), armhole-length
table per size.
