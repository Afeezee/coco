/**
 * lib/model.js
 * -----------------------------------------------------------------------
 * Server-side prediction model for CO2 (sweet) internal pipeline corrosion.
 *
 * This is a degree-2 polynomial regression fit against the 243-row real
 * training dataset (co2_h2s_primary_training_dataset.csv), reconstructed
 * with a physically-motivated multiplicative inhibitor term:
 *
 *     corrosion_rate = base_rate(T, flow, pCO2, internal_pressure, shear, pH)
 *                      * (1 - inhibitor_efficiency / 100)
 *
 * Verified against the original scikit-learn fit: max abs error ~0.075 mm/y
 * on a held-out sample, consistent with the model's own R^2 ~ 0.998-0.999.
 *
 * SCOPE: CO2 (sweet) corrosion only. See README.md "Future work" section
 * for how H2S (sour / mixed corrosion) would be incorporated later -- do
 * not add an H2S term here without also revisiting the validated range,
 * the explainability section, and the UI labels.
 * -----------------------------------------------------------------------
 */

// Coefficients, in the exact order the polynomial terms are built below.
// [T, F, C, I, S, P, T^2, T*F, T*C, T*I, T*S, T*P, F^2, F*C, F*I, F*S, F*P,
//  C^2, C*I, C*S, C*P, I^2, I*S, I*P, S^2, S*P, P^2]
const COEF = [
  1.8021493141577731, -0.031383414863772066, 0.09758821080216196,
  -0.22356342184783953, -0.10461138287918612, 0.11644908310458013,
  -0.006460382392221334, 0.49765481426467567, 0.013858506200354075,
  -0.00019500056087855678, -0.14329993327564503, -0.33512962645484656,
  -0.02168863492256839, 0.07515280721008408, -0.062370570536184146,
  -0.040912034878115795, 0.06881393458667565, -0.1182263301163327,
  -0.0018584765690324038, 0.1529211465648257, 0.7054492019220561,
  0.00038612365151023925, 0.015661520060479685, 0.050333669860493445,
  -0.03176206671452148, 0.11293069885099274, 0.8782665371883004,
];
const INTERCEPT = -24.884375403883872;

function baseRate(T, F, C, I, S, P) {
  const x = [T, F, C, I, S, P];
  const terms = [
    x[0], x[1], x[2], x[3], x[4], x[5],
    x[0] * x[0], x[0] * x[1], x[0] * x[2], x[0] * x[3], x[0] * x[4], x[0] * x[5],
    x[1] * x[1], x[1] * x[2], x[1] * x[3], x[1] * x[4], x[1] * x[5],
    x[2] * x[2], x[2] * x[3], x[2] * x[4], x[2] * x[5],
    x[3] * x[3], x[3] * x[4], x[3] * x[5],
    x[4] * x[4], x[4] * x[5],
    x[5] * x[5],
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
 * @param {number} inputs.shear_stress_Pa
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
    shear_stress_Pa: S,
    pH: P,
    inhibitor_efficiency_pct: inh,
  } = inputs;
  const rate = baseRate(T, F, C, I, S, P) * (1 - inh / 100);
  return Math.max(0, rate);
}

// Validated domain of applicability -- derived from the real 243-row
// training dataset's own min/max. Predictions outside this range are
// extrapolation and must be flagged, not hidden.
const VALID_RANGE = {
  temperature_C: [30, 50],
  flow_velocity_ms: [1.2, 1.8],
  CO2_pressure_bar: [1.0, 2.0],
  internal_pressure_bar: [60, 70],
  shear_stress_Pa: [3, 5],
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
  shear_stress_Pa: 4,
  pH: 3.918519,
  inhibitor_efficiency_pct: 50,
};

const LABELS = {
  temperature_C: "Temperature",
  flow_velocity_ms: "Flow velocity",
  CO2_pressure_bar: "CO2 partial pressure",
  internal_pressure_bar: "Internal pressure",
  shear_stress_Pa: "Shear stress",
  pH: "pH",
  inhibitor_efficiency_pct: "Inhibitor efficiency",
};

function severityOf(rate) {
  if (rate < 3.0) return { label: "LOW", key: "low" };
  if (rate < 5.5) return { label: "MEDIUM", key: "medium" };
  return { label: "HIGH", key: "high" };
}

/**
 * One-at-a-time local contribution estimate: for each feature, how much
 * would the prediction change if that feature alone were reset to its
 * dataset-mean baseline, holding every other input at its current value.
 * This approximates, but is not identical to, a full Shapley/SHAP
 * decomposition -- label it that way in the UI, never call it "SHAP".
 */
function contributions(inputs) {
  const rate = predict(inputs);
  const out = [];
  for (const key of Object.keys(BASELINE)) {
    const swapped = { ...inputs, [key]: BASELINE[key] };
    const ref = predict(swapped);
    out.push({ key, label: LABELS[key], delta: rate - ref });
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
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

module.exports = {
  predict,
  severityOf,
  contributions,
  rangeFlags,
  VALID_RANGE,
  BASELINE,
  LABELS,
};
