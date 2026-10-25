#!/usr/bin/env node
/*
 * Randomised stress test: perturbs every numeric unit parameter and feed of the four
 * industrial templates (±15 %, deterministic seed), occasionally switches evaporator /
 * membrane modes, re-solves and checks that every unit still closes its component and
 * energy balances and never shows negative exergy destruction — including infeasible,
 * warning-raising operating points.
 * Usage: node tests/stress_balances.js [trialsPerTemplate=40] [path/to/html]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const trials = +(process.argv[2] || 40);
const file = process.argv[3] || path.join(__dirname, '..', 'food-flowsheet-pinch-sim.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\* ENGINE-BEGIN \*\/([\s\S]*?)\/\* ENGINE-END \*\//)[1];
const ctx = { module: { exports: {} } }; vm.createContext(ctx); vm.runInContext(src + '\nmodule.exports = FFE;', ctx);
const E = ctx.module.exports;

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const set = E.defaultSettings();
let n = 0, crashes = 0, worstM = 0, worstE = 0, worstX = Infinity, warned = 0;
for (const key of ['fcmp', 'wpi', 'oj', 'pea']) {
  for (let t = 0; t < trials; t++) {
    const fsht = E.buildTemplate(key);
    for (const u of fsht.units) {
      for (const k in u.params) {
        const v = u.params[k];
        if (typeof v === 'number' && rnd() < 0.3) {
          let nv = v * (1 + (rnd() - 0.5) * 0.3);
          if (['eff', 'eta', 'RH', 'moist', 'loss'].includes(k)) nv = Math.min(0.95, Math.max(0.005, nv));
          u.params[k] = nv;
        }
      }
      if (u.type === 'evaporator' && u.params.mode === 'steam' && rnd() < 0.2) { u.params.mode = 'ts'; u.params.TS = 0.2; }
      if (u.type === 'membrane' && rnd() < 0.2) u.params.mode = 'adiabatic';
    }
    for (const sid in fsht.streams) { const s = fsht.streams[sid]; if (s.feed && rnd() < 0.3) { s.feed.flow *= 1 + (rnd() - 0.5) * 0.3; s.feed.T += (rnd() - 0.5) * 10; } }
    try {
      const sim = E.simulate(fsht);
      const v = E.verifyResult(fsht, sim, set);
      n++;
      worstM = Math.max(worstM, v.maxMassRel, v.plantMassRel);
      worstE = Math.max(worstE, v.maxEnRel, v.plantEnRel);
      worstX = Math.min(worstX, v.minExD);
      if (Object.values(v.A.units).some(u => u.warn.length)) warned++;
    } catch (e) { crashes++; console.log('CRASH', key, t, e.message); }
  }
}
console.log(`cases ${n}, crashes ${crashes}, cases with design warnings ${warned}`);
console.log(`worst relative mass residual   ${worstM.toExponential(2)}`);
console.log(`worst relative energy residual ${worstE.toExponential(2)}`);
console.log(`minimum exergy destruction     ${worstX.toExponential(2)} kW`);
const ok = !crashes && worstM < 1e-9 && worstE < 1e-9 && worstX > -1e-6;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
