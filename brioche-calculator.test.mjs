// brioche-calculator.test.mjs — spec §0 five-case harness for brioche-calculator.js.
// Run with: node brioche-calculator.test.mjs

import { solve, HARNESS, NO2_ANCHOR, NO2_TOLERANCE_RIBS } from "./brioche-calculator.js";

function dist5(arr) {
  return `Lback ${arr[0]} · Lsleeve ${arr[1]} · Front ${arr[2]} · Rsleeve ${arr[3]} · Rback ${arr[4]}`;
}

let allOk = true;

for (const [name, args] of Object.entries(HARNESS)) {
  const r = solve(args);
  if (!r.ok) {
    console.log(`${name}: NO SOLUTION`);
    allOk = false;
    continue;
  }

  const checksOk = Object.values(r.closure_checks).every(Boolean);
  allOk = allOk && checksOk;

  console.log(
    `${name}: CO${r.CO_ribs}(${r.CO_cm}cm) neck${r.neck_ribs}(${r.neck_cm}cm) ` +
    `inc${r.one_time_inc} pre${r.preraglan_ribs} ` +
    `${r.blocks.full}F+${r.blocks.light}L x${r.blocks.rows_each}r Y4tot${r.Y4_ribs} ` +
    `F${r.Y4.front}/B${r.Y4.back}/S${r.Y4.sleeve_preUA}/UA${r.Y4.UA} ` +
    `bust${r.Y4.finished_bust_cm}cm slv${r.Y4.finished_sleeve_cm}cm ` +
    `checks=${checksOk}`
  );
  console.log(`      preraglan: ${dist5(r.distributions.preraglan)}`);
  console.log(`      Y4:        ${dist5(r.distributions.Y4)}`);
  if (!checksOk) {
    console.log(`      FAILED CHECKS:`, r.closure_checks);
  }

  if (name === "No2") {
    for (const [field, target] of Object.entries(NO2_ANCHOR)) {
      const achieved = r[field];
      const gap = Math.abs(achieved - target);
      const status = gap <= NO2_TOLERANCE_RIBS ? "OK" : "OUT OF TOLERANCE";
      console.log(`      anchor check ${field}: target=${target} achieved=${achieved} gap=${gap} [${status}]`);
      if (gap > NO2_TOLERANCE_RIBS) allOk = false;
    }
  }
}

console.log(`\nHARNESS ${allOk ? "PASSED" : "FAILED"}`);
process.exit(allOk ? 0 : 1);
