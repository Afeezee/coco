/**
 * lib/model.js
 * -----------------------------------------------------------------------
 * Server-side prediction model for CO2 (sweet) internal pipeline corrosion.
 *
 * v1.1 (2026-09-14): shear_stress_Pa REMOVED as a separate input.
 * The training data has shear_stress_Pa = 3.3333 * flow_velocity_ms - 1.0
 * exact to floating-point noise (r=1.00 against the real 243 rows), so
 * shear stress carries no independent information the tree models weren't
 * already getting from flow velocity. Refit surrogate CV R^2 unchanged
 * (RF 0.995 -> 0.995, XGB 0.998 -> 0.998). Sweeping flow velocity across
 * its full slider range now gives a smooth 3.99-4.76 mm/y, replacing the
 * 0-10.4 mm/y blow-up the two-collinear-inputs version could produce when
 * users desynced the sliders.
 *
 * This is a degree-2 polynomial regression on 5 base features:
 *   T = temperature_C, F = flow_velocity_ms, C = CO2_pressure_bar,
 *   I = internal_pressure_bar, P = pH
 * combined with a physically-motivated multiplicative inhibitor term:
 *
 *     corrosion_rate = baseRate(T, F, C, I, P) * (1 - inhibitor_efficiency / 100)
 *
 * SCOPE: CO2 (sweet) corrosion only. See README.md and RESULTS.md.
 * -----------------------------------------------------------------------
 */

// Coefficients, in the exact order the polynomial terms are built below.
// [T, F, C, I, P, T^2, T*F, T*C, T*I, T*P, F^2, F*C, F*I, F*P,
//  C^2, C*I, C*P, I^2, I*P, P^2]
const COEF = [
  1.9454492474334244, -0.12742887815344245, 0.09076824548180858,
  -0.23922494190834132, 0.11554530575890297, -0.006460382392221425,
  0.01998837001252425, 0.013858506200354271, -0.00019500056087854803,
  -0.3351296264548448, -0.5109739368998609, 0.5848899624261911,
  -0.010165503667919244, 0.4452495974234912, -0.12436660221329011,
  -0.0018584765690316928, 0.6734978611771331, 0.00038612365151026635,
  0.050333669860497955, 0.8720166358875101,
];
const INTERCEPT = -25.171790899095917;

function baseRate(T, F, C, I, P) {
  const x = [T, F, C, I, P];
  const terms = [
    x[0], x[1], x[2], x[3], x[4],
    x[0] * x[0], x[0] * x[1], x[0] * x[2], x[0] * x[3], x[0] * x[4],
    x[1] * x[1], x[1] * x[2], x[1] * x[3], x[1] * x[4],
    x[2] * x[2], x[2] * x[3], x[2] * x[4],
    x[3] * x[3], x[3] * x[4],
    x[4] * x[4],
  ];
  let s = INTERCEPT;
  for (let i = 0; i < terms.length; i++) s += COEF[i] * terms[i];
  return s;
}

/**
 * @param {object} inputs
 * @param {number} inputs.temperature_C
 * @param {number} inputs.flow_velocity_ms
 * @param {number} inputs.CO2_pressure_bar
 * @param {number} inputs.internal_pressure_bar
 * @param {number} inputs.pH
 * @param {number} inputs.inhibitor_efficiency_pct
 * @returns {number} predicted corrosion rate, mm/year (never negative)
 */
function predict(inputs) {
  const {
    temperature_C: T,
    flow_velocity_ms: F,
    CO2_pressure_bar: C,
    internal_pressure_bar: I,
    pH: P,
    inhibitor_efficiency_pct: inh,
  } = inputs;
  const rate = baseRate(T, F, C, I, P) * (1 - inh / 100);
  return Math.max(0, rate);
}

// Default operating conditions shown on cold-load. These match the worked
// example in Section 4.7 / Figure 4 of the paper exactly, so the console's
// initial state doubles as a standing verification of the figure caption
// every time the page loads. All six values sit inside VALID_RANGE.
const DEFAULTS = {
  temperature_C: 43,
  flow_velocity_ms: 1.40,
  CO2_pressure_bar: 1.60,
  internal_pressure_bar: 66,
  pH: 3.95,
  inhibitor_efficiency_pct: 55,
};

// Validated domain of applicability -- derived from the real 243-row
// training dataset's own min/max. Predictions outside this range are
// extrapolation and must be flagged, not hidden.
const VALID_RANGE = {
  temperature_C: [30, 50],
  flow_velocity_ms: [1.2, 1.8],
  CO2_pressure_bar: [1.0, 2.0],
  internal_pressure_bar: [60, 70],
  pH: [3.8, 4.0],
  inhibitor_efficiency_pct: [40, 60],
};

// Dataset means, used as the baseline for the one-at-a-time contribution
// decomposition below.
const BASELINE = {
  temperature_C: 40,
  flow_velocity_ms: 1.5,
  CO2_pressure_bar: 1.5,
  internal_pressure_bar: 65,
  pH: 3.918519,
  inhibitor_efficiency_pct: 50,
};

const LABELS = {
  temperature_C: "Temperature",
  flow_velocity_ms: "Flow velocity",
  CO2_pressure_bar: "CO2 partial pressure",
  internal_pressure_bar: "Internal pressure",
  pH: "pH",
  inhibitor_efficiency_pct: "Inhibitor efficiency",
};

function severityOf(rate) {
  if (rate < 3.0) return { label: "LOW", key: "low" };
  if (rate < 5.5) return { label: "MEDIUM", key: "medium" };
  return { label: "HIGH", key: "high" };
}

function rangeFlags(inputs) {
  const flags = {};
  let anyOut = false;
  for (const key of Object.keys(VALID_RANGE)) {
    const [lo, hi] = VALID_RANGE[key];
    const out = inputs[key] < lo || inputs[key] > hi;
    flags[key] = out;
    if (out) anyOut = true;
  }
  return { flags, anyOut };
}

/**
 * One-at-a-time local contribution estimate: for each feature, how much
 * would the prediction change if that feature alone were reset to its
 * dataset-mean baseline, holding every other input at its current value.
 *
 * Each entry now carries its own dynamic `note` field describing the
 * magnitude in words for THIS input combination -- replaces the static
 * per-feature caveats that could contradict the number shown on the bar
 * (e.g. "biggest driver" plus "non-influential" on the same feature).
 * A feature's local contribution here can legitimately differ from its
 * average importance across the whole dataset in RESULTS.md.
 */
function contributions(inputs) {
  const rate = predict(inputs);
  const out = [];
  for (const key of Object.keys(BASELINE)) {
    const swapped = { ...inputs, [key]: BASELINE[key] };
    const ref = predict(swapped);
    const delta = rate - ref;
    const magnitude = Math.abs(delta);
    let note;
    if (magnitude < 0.05) {
      note = `Estimated local contribution is negligible (${delta.toFixed(2)} mm/y) for this input combination.`;
    } else {
      note = `Estimated local contribution is ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} mm/y for this specific input combination; this can differ from a feature's average importance across the whole dataset (see RESULTS.md).`;
    }
    out.push({ key, label: LABELS[key], delta, note });
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

module.exports = {
  predict,
  severityOf,
  contributions,
  rangeFlags,
  VALID_RANGE,
  BASELINE,
  LABELS,
  DEFAULTS,
};
