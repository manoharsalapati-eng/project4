#!/usr/bin/env node
/*
 * Independent numerical verification of food-flowsheet-pinch-sim.html
 *
 * 1. Extracts the simulation engine from the HTML file (between ENGINE-BEGIN/END).
 * 2. Re-implements the Choi & Okos (1986) enthalpy model, the ice-fraction model
 *    and the vapour / humid-air enthalpies from scratch and checks that they
 *    reproduce the engine's stream enthalpies.
 * 3. Builds and converges every industrial template and checks, with the
 *    independent enthalpy function:
 *      - component mass balance of every unit and of the plant boundary
 *      - energy balance of every unit and of the plant boundary
 *      - second law: exergy destruction >= 0 in every unit
 *      - design specifications met
 *      - pinch targets: energy closure and an independent cascade feasibility check
 * Usage:  node tests/verify_balances.js [path/to/food-flowsheet-pinch-sim.html]
 * Exit code 0 = all checks pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'food-flowsheet-pinch-sim.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/\/\* ENGINE-BEGIN \*\/([\s\S]*?)\/\* ENGINE-END \*\//);
if (!m) { console.error('Engine block not found'); process.exit(2); }
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(m[1] + '\nmodule.exports = FFE;', ctx);
const E = ctx.module.exports;

// ------------------------------------------------ independent property model
// Choi & Okos (1986) specific heats, kJ/kg K, T in °C
const CP = {
  water: [4.1762, -9.0864e-5, 5.4731e-6], waterBelow0: [4.0817, -5.3062e-3, 9.9516e-4],
  protein: [2.0082, 1.2089e-3, -1.3129e-6], fat: [1.9842, 1.4733e-3, -4.8008e-6],
  carb: [1.5488, 1.9625e-3, -5.9399e-6], fiber: [1.8459, 1.8306e-3, -4.6509e-6],
  ash: [1.0926, 1.8896e-3, -3.6817e-6], ice: [2.0623, 6.0769e-3, 0]
};
const integ = (c, T) => c[0] * T + c[1] * T * T / 2 + c[2] * T * T * T / 3;   // ∫0..T cp dT
const hWater = T => integ(T >= 0 ? CP.water : CP.waterBelow0, T);
const hIce = T => -333.6 + integ(CP.ice, T);
function freezingPoint(x) {   // Raoult estimate as documented in Methods
  if (x[0] <= 1e-12) return -Infinity;
  const mol = (x[3] / 0.25 + x[5] / 0.058 + x[1] / 20) / x[0];
  return Math.min(-1.86 * mol * (1 + 0.05 * mol), -1e-3);
}
function hFoodRef(x, T) {
  const Tf = freezingPoint(x);
  let xi = 0;
  if (T < Tf) xi = Math.max(0, x[0] - 0.4 * x[1]) * (1 - Tf / T);
  return (x[0] - xi) * hWater(T) + xi * hIce(T) +
    x[1] * integ(CP.protein, T) + x[2] * integ(CP.fat, T) + x[3] * integ(CP.carb, T) + x[4] * integ(CP.fiber, T) + x[5] * integ(CP.ash, T);
}
function Href(s) {     // kW
  const F = s.F, mf = F[0] + F[1] + F[2] + F[3] + F[4] + F[5];
  if (s.kind === 'food') return ((mf > 0 ? mf * hFoodRef(F.slice(0, 6).map(v => v / mf), s.T) : 0) + F[6] * 1.006 * s.T) / 3600;
  if (s.kind === 'vapor') return F[0] * (2501 + 1.88 * s.T) / 3600;
  return (F[6] * 1.006 * s.T + F[0] * (2501 + 1.88 * s.T)) / 3600;
}

// ------------------------------------------------ checks
let failures = 0;
const fail = msg => { failures++; console.log('  FAIL ' + msg); };
const sum = a => a.reduce((s, v) => s + v, 0);
const set = E.defaultSettings();
const TOL = { unitMass: 1e-9, unitEnergy: 1e-9, plant: 1e-8, enth: 1e-10, pinch: 1e-6 };

console.log(`Verifying ${path.basename(file)}\n`);
const summary = [];
for (const key of ['fcmp', 'wpi', 'oj', 'pea']) {
  const fsht = E.buildTemplate(key);
  const sim = E.simulate(fsht);
  const A = E.analyze(fsht, sim, set);
  console.log(`== ${fsht.name}`);
  if (!sim.converged) fail('recycle loop not converged');
  sim.specs.forEach(sp => { if (!sp.converged) fail(`design spec "${sp.name}" not met (${sp.achieved} vs ${sp.target})`); });

  // enthalpy model agreement
  let maxEnthDev = 0;
  for (const sid in sim.S) {
    const s = sim.S[sid], a = E.Hs(s), b = Href(s);
    maxEnthDev = Math.max(maxEnthDev, Math.abs(a - b) / Math.max(1, Math.abs(b)));
  }
  if (maxEnthDev > TOL.enth) fail(`engine enthalpy deviates from independent Choi–Okos model by ${maxEnthDev}`);

  // unit balances (independent enthalpy)
  let maxM = 0, maxEn = 0, minExD = Infinity, worst = '';
  for (const u of fsht.units) {
    const rec = sim.U[u.id];
    const ins = rec.ins.filter(Boolean).concat(rec.r.aux.filter(Boolean)), outs = rec.r.outs.filter(Boolean);
    const mIn = sum(ins.map(s => sum(s.F)));
    for (let i = 0; i < 7; i++) {
      const res = sum(ins.map(s => s.F[i])) - sum(outs.map(s => s.F[i]));
      const rel = Math.abs(res) / Math.max(1, mIn);
      maxM = Math.max(maxM, rel);
      if (rel > TOL.unitMass) fail(`${u.tag}: component ${E.CN[i]} residual ${res} kg/h`);
    }
    const Qh = sum(rec.r.duties.filter(d => d.type === 'hot').map(d => d.Q)), Qc = sum(rec.r.duties.filter(d => d.type === 'cold').map(d => d.Q));
    const Hin = sum(ins.map(Href)), Hout = sum(outs.map(Href));
    const eres = Hin + Qh - Qc + rec.r.W - rec.r.Qloss - Hout;
    const erel = Math.abs(eres) / Math.max(1, Math.abs(Hin) + Qh + Qc + rec.r.W);
    maxEn = Math.max(maxEn, erel);
    if (erel > TOL.unitEnergy) fail(`${u.tag}: energy residual ${eres} kW`);
    const ExD = A.units[u.id].ex.D;
    if (ExD < minExD) { minExD = ExD; worst = u.tag; }
    if (ExD < -1e-6 * Math.max(1, A.units[u.id].ex.in)) fail(`${u.tag}: negative exergy destruction ${ExD} kW`);
  }

  // plant boundary
  const feeds = [], prods = [];
  for (const sid in fsht.streams) { const s = fsht.streams[sid]; if (!s.src && s.dst) feeds.push(sim.S[sid]); if (s.src && !s.dst) prods.push(sim.S[sid]); }
  const mTot = sum(feeds.map(s => sum(s.F)));
  let plantM = 0;
  for (let i = 0; i < 7; i++) plantM = Math.max(plantM, Math.abs(sum(feeds.map(s => s.F[i])) - sum(prods.map(s => s.F[i]))) / Math.max(1, mTot));
  let Qh = 0, Qc = 0, W = 0, QL = 0;
  for (const u of fsht.units) { const r = sim.U[u.id].r; r.duties.forEach(d => d.type === 'hot' ? Qh += d.Q : Qc += d.Q); W += r.W; QL += r.Qloss; }
  const Hf = sum(feeds.map(Href)), Hp = sum(prods.map(Href));
  const plantE = Math.abs(Hf + Qh - Qc + W - QL - Hp) / Math.max(1, Math.abs(Hf) + Qh + Qc + W);
  if (plantM > TOL.plant) fail(`plant mass closure ${plantM}`);
  if (plantE > TOL.plant) fail(`plant energy closure ${plantE}`);

  // pinch: closure + independent cascade feasibility at the reported Q_H,min
  const dT = 10, pr = E.pinch(A.pinchStreams, dT);
  const hot = A.pinchStreams.filter(s => s.type === 'hot'), cold = A.pinchStreams.filter(s => s.type === 'cold');
  const Qhot = sum(hot.map(s => s.Q)), Qcold = sum(cold.map(s => s.Q));
  const closure = (pr.QH - pr.QC) - (Qcold - Qhot);
  if (Math.abs(closure) > TOL.pinch) fail(`pinch energy closure ${closure} kW`);
  const Hshift = (s, Ts) => {      // cumulative heat of a stream below shifted temperature Ts
    const d = s.type === 'hot' ? -dT / 2 : dT / 2, p = s.pts;
    const T = Ts - d;
    if (T <= p[0].T) return 0;
    if (T >= p[p.length - 1].T) return p[p.length - 1].H;
    for (let k = 0; k < p.length - 1; k++) if (T <= p[k + 1].T) return p[k].H + (p[k + 1].H - p[k].H) * (T - p[k].T) / (p[k + 1].T - p[k].T);
    return p[p.length - 1].H;
  };
  const grid = [];
  A.pinchStreams.forEach(s => s.pts.forEach(p => grid.push(p.T + (s.type === 'hot' ? -dT / 2 : dT / 2))));
  const lo = Math.min(...grid), hi = Math.max(...grid);
  for (let i = 0; i <= 4000; i++) grid.push(lo + (hi - lo) * i / 4000);
  let minCascade = Infinity;
  for (const Ts of grid) {
    const R = pr.QH + (Qhot - sum(hot.map(s => Hshift(s, Ts)))) - (Qcold - sum(cold.map(s => Hshift(s, Ts))));
    minCascade = Math.min(minCascade, R);
  }
  if (minCascade < -TOL.pinch * Math.max(1, Qhot)) fail(`heat cascade infeasible at reported Q_H,min (min ${minCascade} kW)`);
  if (pr.QH > TOL.pinch && minCascade > TOL.pinch * Math.max(1, Qhot)) fail(`Q_H,min not minimal (cascade minimum ${minCascade} kW > 0)`);

  const row = { template: fsht.name, converged: sim.converged, tears: sim.seq.tears.join(','), specs: sim.specs.map(s => `${s.name}: ${(+s.achieved).toPrecision(6)}`).join('; '),
    unitMassRel: maxM, unitEnergyRel: maxEn, plantMassRel: plantM, plantEnergyRel: plantE, enthalpyModelDev: maxEnthDev, minExD_kW: minExD, QHmin_kW: pr.QH, QCmin_kW: pr.QC, pinchClosure_kW: closure, minCascade_kW: minCascade };
  summary.push(row);
  console.log(`  converged=${sim.converged} tears=[${row.tears}] passes=${sim.passes}`);
  sim.specs.forEach(s => console.log(`  spec "${s.name}": achieved ${(+s.achieved).toPrecision(8)} (target ${s.target}) via ${(+s.x).toPrecision(6)}`));
  console.log(`  max unit mass residual (rel)   ${maxM.toExponential(2)}`);
  console.log(`  max unit energy residual (rel) ${maxEn.toExponential(2)}  [independent Choi–Okos enthalpy]`);
  console.log(`  plant mass / energy closure    ${plantM.toExponential(2)} / ${plantE.toExponential(2)}`);
  console.log(`  engine vs independent enthalpy ${maxEnthDev.toExponential(2)}`);
  console.log(`  min exergy destruction         ${minExD.toFixed(6)} kW (${worst})`);
  console.log(`  pinch @10 K: QH,min ${pr.QH.toFixed(2)} kW, QC,min ${pr.QC.toFixed(2)} kW, closure ${closure.toExponential(2)} kW, min cascade ${minCascade.toExponential(2)} kW`);
  console.log(`  product ${A.prodSid}: ${A.mProd.toFixed(2)} kg/h, utility cost ₹${A.totals.perKg.INR.toFixed(2)}/kg (€${A.totals.perKg.EUR.toFixed(3)}/kg)\n`);
}

console.log('== Property engine self-tests');
for (const t of E.propertySelfTests()) {
  console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}: ${t.value.toPrecision(6)} (ref ${t.ref}, ±${t.tol.toPrecision(3)} ${t.unit})`);
  if (!t.pass) failures++;
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll mass, energy, second-law and pinch checks passed.');
process.exit(failures ? 1 : 0);
