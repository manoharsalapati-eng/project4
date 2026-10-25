# Food Process Flowsheet Simulator · Pinch · Exergy

`food-flowsheet-pinch-sim.html` is a standalone, single-file food process simulator. Open it in any modern browser; it needs no install, no server and no network. All calculations run locally.

It has four parts:

1. **Choi & Okos (1986) property engine.** Density, specific heat (sensible and apparent), thermal conductivity (parallel and series), thermal diffusivity and enthalpy from −40 to 150 °C. Inputs are the proximate mass fractions: water, protein, fat, carbohydrate, fiber, ash and ice. An automatic freezing model gives the initial freezing point and the ice fraction.
2. **Flowsheet simulator.** A sequential-modular solver for mass, component and energy balances:
   - Tear streams are selected automatically and converged with Wegstein acceleration.
   - Design specifications (controller loops) are solved around the converged recycle loops.
   - Four industrial templates are included, plus a blank flowsheet.
   - You can add, delete, connect and drag units and feeds.
3. **Pinch analysis.** Hot and cold streams are extracted automatically from every unit with a heat duty:
   - Shifted or actual composite curves and the grand composite curve, for any ΔTmin.
   - Q_H,min, Q_C,min and the pinch temperature.
   - Energy targets against ΔTmin.
   - Utility placement read from the grand composite curve.
   - Savings in ₹/yr, €/yr and t CO₂/yr.
4. **Second-law and techno-economic breakdown.** For every unit operation: exergy destruction (kW), exergy lost with exhaust, and exergy efficiency η_II. Utility systems (boiler house, chillers, cooling towers) are reported separately. Steam, fuel, electricity, water and CO₂ are costed per unit in ₹ and €, per hour and per kg of product.

## Templates

| Plant | Main product | Product kg/h | Live steam kg/h | Hot utility now → target, kW (ΔTmin 10 K) | Exergy destroyed in process units, kW | Utility cost per kg |
|---|---|---:|---:|---|---:|---|
| Full-cream milk powder (10 t/h raw milk) | FCMP, 26 % fat in DM | 1,190.8 | 4,613 | 3,160 → 2,777 | 1,073 | ₹16.23 · €0.164 |
| Whey protein isolate, UF/DF and spray drying (20 t/h whey) | WPI, 90 % protein in DM | 133.1 | 897 | 813 → 699 | 343 | ₹43.39 · €0.438 |
| Orange juice concentrate, 4-effect evaporator (20 t/h juice) | FCOJ 65 °Brix | 3,661.5 | 5,486 | 3,392 → 3,096 | 757 | ₹5.52 · €0.056 |
| Pea protein extraction (2 t/h flour) | Pea protein isolate | 437.1 | 3,757 | 2,796 → 2,143 | 1,193 | ₹45.11 · €0.456 |

Costs use the default India tariffs with natural-gas steam. All tariffs, the dead state, boiler and cooling-tower assumptions can be edited in the app. An EU tariff set is built in.

Each template contains at least two recycle (tear) loops and at least one design specification:

* **Milk powder:** fines return to the dryer, and condensate pre-warming the raw milk. Cream remix is set to give 26 % fat in DM; steam to effect 1 is set to give 48 % TS.
* **WPI:** pasteuriser regeneration and fines return. Diafiltration water is set to give 90 % protein in DM.
* **Orange juice:** finisher recirculation and condensate pre-heating. Steam is set to give 65 °Brix.
* **Pea protein:** whey recycle to extraction and fines return. Dilution water is set to give a 16 % TS dryer feed.

## Verification

Mass and enthalpy balances are verified numerically, both inside the app ("Balance verification" tab) and by two Node scripts:

```bash
node tests/verify_balances.js    # independent re-implementation of the Choi–Okos enthalpy model
node tests/stress_balances.js    # 160 randomly perturbed operating points
```

`verify_balances.js` takes the engine out of the HTML file and rebuilds every template from scratch. It checks, with its own enthalpy functions:

* stream enthalpies against an independent implementation of the Choi–Okos, ice, vapour and humid-air models;
* the component mass balance and the energy balance of every unit and of the plant boundary;
* exergy destruction ≥ 0 in every unit;
* that every design spec is met;
* the pinch energy closure, (Q_H − Q_C) − (Σcold − Σhot);
* that the heat cascade is feasible at the reported Q_H,min, and that Q_H,min is the minimum.

Current results for all four templates:

| Check | Worst result |
|---|---|
| Unit component balances (relative) | 1.3e-16 |
| Unit energy balances (relative, independent enthalpy) | 2.9e-16 |
| Plant mass / energy closure | 5.7e-14 / 7.6e-15 |
| Engine vs independent enthalpy model | 2.3e-16 |
| Minimum unit exergy destruction | 0 kW (splitters); all others > 0 |
| Pinch energy closure | < 4e-12 kW |

`stress_balances.js` perturbs every unit parameter and feed by up to ±15 % and sometimes switches unit modes. Across 160 cases, including infeasible ones that raise warnings:

* worst relative mass residual: 5.5e-13;
* worst relative energy residual: 8.3e-14;
* no negative exergy destruction.

Property self-tests compare the engine with IAPWS water and published milk data, and check that the enthalpy matches ∫cp_app dT across the freezing range.

## Methods (summary)

The **Methods** tab in the app documents every equation. In short:

* **Enthalpy reference:** 0 °C liquid water and dry air. Water vapour is an ideal gas (h = 2501 + 1.88 T). Humid air is 1.006 T + Y·h_v per kg of dry air.
* **Freezing and boiling:** freezing point and boiling-point elevation come from a Raoult-law estimate, and can be overridden. Ice fraction uses the Miles/Pham model with bound water 0.4·x_protein.
* **Unit models:** mixer, splitter, pump, utility heater/cooler, process–process exchanger (effectiveness or outlet T, with an approach check), holding tube, membrane (VCF + rejection + continuous diafiltration), centrifuge/decanter, falling-film evaporator effect (live steam or vapour heated, with BPE and a driving-force limit), flash, condenser, spray/fluid-bed dryer (air flow from the chamber energy balance, two-stage air heater), stirred tank/reactor.
* **Pinch:** problem-table algorithm on piecewise-linear H–T profiles. Variable cp and latent duties are represented.
* **Exergy:** physical exergy only, dead state T₀ (default 25 °C), liquid water and dry air. Vapour exergy uses the saturation curve that is consistent with the property model, so every unit's second-law balance is exact.

## Files

```
food-flowsheet-pinch-sim.html   the simulator (engine + UI in one file)
tests/verify_balances.js        independent balance / second-law / pinch verification
tests/stress_balances.js        randomised robustness test
```

## Limitations

* The model works on proximate composition only. Colligative properties are estimates.
* Choi–Okos describes non-porous foods; powder porosity is not modelled.
* Exchanger and evaporator areas are estimates from assumed U values. There is no capital costing, so ΔTmin is a user choice rather than a supertargeting optimum.
* Pressure drops are modelled only for pumps.
