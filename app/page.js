"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Gauge from "../components/Gauge";
import PipeCanvas from "../components/PipeCanvas";
import { DEFAULTS } from "../lib/model";

// Slider order/config. shear_stress_Pa removed in model v1.1 -- it was a
// deterministic duplicate of flow_velocity_ms in the training data and
// allowed the user to create desynced combinations the model was never
// shown. See lib/model.js header.
const SLIDER_CONFIG = [
  { key: "temperature_C", label: "Temperature", unit: "\u00B0C", min: 10, max: 70, step: 1 },
  { key: "flow_velocity_ms", label: "Flow velocity", unit: "m/s", min: 0.8, max: 2.2, step: 0.1 },
  { key: "CO2_pressure_bar", label: "CO2 partial pressure", unit: "bar", min: 0.4, max: 2.6, step: 0.1 },
  { key: "internal_pressure_bar", label: "Internal pressure", unit: "bar", min: 50, max: 80, step: 1 },
  { key: "pH", label: "pH", unit: "", min: 3.0, max: 5.0, step: 0.05 },
  { key: "inhibitor_efficiency_pct", label: "Inhibitor efficiency", unit: "%", min: 0, max: 100, step: 1 },
];

const SEVERITY_COLOR = { low: "var(--safe)", medium: "var(--amber)", high: "var(--rust-1)" };

// Wall-life scenario assumptions used in the textual summary. Disclosed
// in the on-screen note so nobody mistakes them for a per-line forecast.
const WALL_MM = 10;             // nominal carbon-steel wall thickness
const RETIREMENT_FRAC = 0.5;    // typical 50% wall-loss retirement rule

// Feature-specific action hints for the top-driver recommendation.
// Wording matches what the RESULTS.md feature-importance section says
// is and isn't actionable in this model.
const ACTION_HINT = {
  inhibitor_efficiency_pct:
    "Increasing inhibitor efficiency is by far the strongest lever in the model — moving the current setting toward 60%+ typically produces the largest single reduction in rate.",
  temperature_C:
    "Lowering the operating temperature back toward 40 °C would meaningfully cut the rate at this pCO₂ / pH.",
  CO2_pressure_bar:
    "Reducing CO₂ partial pressure — e.g. via upstream dehydration or gas sweetening — would be the highest-impact operational change here.",
  flow_velocity_ms:
    "Flow velocity is a weak driver in this model; changing it alone is unlikely to produce a large reduction.",
  internal_pressure_bar:
    "Internal pressure is a very weak driver in this model — do not expect a meaningful change from adjusting it.",
  pH:
    "pH sensitivity is weak within the validated 3.8–4.0 envelope; expect only a small effect from changing it.",
};

function formatYears(years) {
  if (!Number.isFinite(years) || years <= 0) return "—";
  if (years < 0.5) return `${Math.max(1, Math.round(years * 12))} months`;
  if (years < 10) return `${years.toFixed(1)} years`;
  if (years < 100) return `${Math.round(years)} years`;
  return "well over a century";
}

export default function Page() {
  const [inputs, setInputs] = useState(DEFAULTS);
  const [prediction, setPrediction] = useState(null);
  const [predictError, setPredictError] = useState(null);

  const [imageEl, setImageEl] = useState(null);
  const [grounding, setGrounding] = useState(null);
  const [visionStatus, setVisionStatus] = useState("");
  const [visionLoading, setVisionLoading] = useState(false);
  const fileInputRef = useRef(null);
  const debounceRef = useRef(null);

  const runPrediction = useCallback((values) => {
    fetch("/api/predict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Prediction failed");
        return res.json();
      })
      .then((data) => {
        setPrediction(data);
        setPredictError(null);
      })
      .catch((err) => setPredictError(err.message));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runPrediction(inputs), 150);
    return () => clearTimeout(debounceRef.current);
  }, [inputs, runPrediction]);

  const handleSlider = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: parseFloat(value) }));
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => setImageEl(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);

    // A new photo represents a new pipe section — reset the sliders and
    // clear any stale prediction error so the panel starts from the same
    // baseline conditions the model was calibrated on. The debounced
    // useEffect below will re-fetch /api/predict with DEFAULTS on its own.
    setInputs(DEFAULTS);
    setPredictError(null);

    setVisionLoading(true);
    setVisionStatus("Analysing photo for pipe geometry and features...");
    setGrounding(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_base64: base64, media_type: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Vision request failed");
      setGrounding(data);
      setVisionStatus(
        data.orientation && data.orientation !== "unclear"
          ? `Detected orientation: ${data.orientation}. ${data.features?.length || 0} feature(s) located.`
          : data.notes || "Could not confidently identify pipe geometry -- using default overlay."
      );
    } catch (err) {
      setVisionStatus(`Vision analysis unavailable (${err.message}) -- using default overlay.`);
    } finally {
      setVisionLoading(false);
    }
  };

  const rate = prediction ? prediction.corrosion_rate_mmpy : 0;
  const severityFrac = Math.min(rate, 10) / 10;
  const severity = prediction ? prediction.severity : { label: "\u2014", key: "low" };
  const maxAbsContribution = prediction
    ? Math.max(...prediction.contributions.map((c) => Math.abs(c.delta_mmpy)), 0.001)
    : 1;

  return (
    <div className="page">
      <div className="disclaimer-banner" role="note">
        <strong>Research prototype.</strong> Illustrative only. Not validated for
        operational or safety-critical use. Predictions outside the stated
        validated domain are extrapolation and should not be relied upon.
      </div>
      <div className="nameplate">
        <div>
          <h1>CoCo: Corrosion Console</h1>
          <div className="sub">Explainable ML &mdash; CO2 (sweet) internal pipeline corrosion, carbon steel</div>
        </div>
        <div className="tag">MODEL DOMAIN: 30&ndash;50&#176;C &middot; pH 3.8&ndash;4.0</div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>
            Pipe section <span className="subhint">upload a photo for grounded overlay</span>
          </h2>
          <PipeCanvas image={imageEl} grounding={grounding} severityFrac={severityFrac} />
          <div className="uploadbar">
            <button
              className="uploadbtn"
              onClick={() => fileInputRef.current?.click()}
              disabled={visionLoading}
            >
              {visionLoading ? "Analysing\u2026" : "Upload pipe photo"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <span className="uploadhint">No photo? A schematic section is shown by default.</span>
          </div>
          <div className="vision-status">{visionStatus}</div>
          {grounding?.visible_anomalies?.length > 0 && (
            <div className="anomaly-note">
              Visible surface anomaly noted in photo (separate from the internal-corrosion
              prediction below): {grounding.visible_anomalies.map((a) => a.description).join("; ")}
            </div>
          )}
          <div className="legend">
            <span>
              <span className="dot" style={{ background: "var(--rust-2)" }} />
              Invert / bottom band (water &amp; condensate settle here)
            </span>
            <span>
              <span className="dot" style={{ background: "var(--amber)" }} />
              Weld / joint zones (local turbulence)
            </span>
          </div>
          <div className="note">
            These zones are physically-motivated risk markers (gravity-driven water film at the
            pipe invert, flow disturbance near welds/joints), placed at real detected feature
            locations once a photo is analysed. This is not a pixel-level detection of internal
            corrosion &mdash; internal CO2 corrosion is not visible from outside the pipe. Marker
            intensity scales with the model&apos;s predicted corrosion rate.
          </div>
        </div>

        <div className="panel">
          <h2>Operating conditions</h2>
          {SLIDER_CONFIG.map((s) => {
            const out = prediction?.range_flags?.[s.key];
            return (
              <div className="slider-row" key={s.key}>
                <div className="slider-label">
                  <span>{s.label}</span>
                  <span className="val">
                    {inputs[s.key].toFixed(s.step < 1 ? 2 : 0)} {s.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={inputs[s.key]}
                  onChange={(e) => handleSlider(s.key, e.target.value)}
                />
                <div className={`range-flag ${out ? "show" : ""}`}>
                  outside validated range &mdash; extrapolated
                </div>
              </div>
            );
          })}
          <div className={`confidence-banner ${prediction?.outside_validated_range ? "show" : ""}`}>
            <span>&#9888;</span>
            <span>
              One or more inputs sit outside the range the model was trained on &mdash; treat this
              prediction as a rough extrapolation, not a validated result.
            </span>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Predicted corrosion rate</h2>
          <div className="gauge-wrap">
            <Gauge rate={rate} />
            <div>
              <span className="gauge-num">{rate.toFixed(2)}</span>
              <span className="gauge-unit">mm/year</span>
            </div>
            <div
              className="severity-badge"
              style={{
                background: `color-mix(in srgb, ${SEVERITY_COLOR[severity.key]} 20%, transparent)`,
                color: SEVERITY_COLOR[severity.key],
              }}
            >
              {severity.label}
            </div>
          </div>
          {prediction && renderExplanation(prediction)}
          {predictError && <div className="note">Prediction error: {predictError}</div>}
        </div>

        <div className="panel">
          <h2>What&apos;s driving this prediction</h2>
          <div className="bars">
            {prediction?.contributions.map((c) => {
              const pct = (Math.abs(c.delta_mmpy) / maxAbsContribution) * 100;
              const col = c.delta_mmpy >= 0 ? "var(--rust-1)" : "var(--safe)";
              return (
                <div className="bar-row" key={c.key}>
                  <div className="bar-label">
                    <span>{c.label}</span>
                    <span>
                      {c.delta_mmpy >= 0 ? "+" : ""}
                      {c.delta_mmpy.toFixed(2)} mm/y
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: col }} />
                  </div>
                  {c.note && <div className="bar-note">{c.note}</div>}
                </div>
              );
            })}
          </div>
          <div className="note">
            Each bar shows how much the prediction would shift if that input alone were reset
            to its typical dataset value, holding all others fixed. This is a local, one-at-a-time
            estimate; it approximates, but is not identical to, a full Shapley-value (SHAP)
            decomposition.
          </div>
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Plain-English scenario summary drawn from the prediction the model
 * already returned -- no LLM in the loop, so it is deterministic and
 * matches the numbers in the gauge and the contribution bars exactly.
 *
 * Two parts:
 *   1. Wall-life outlook: how long a nominal WALL_MM wall would take to
 *      hit the 50% retirement threshold and to be fully consumed at the
 *      current rate. Both assumptions are disclosed in the on-screen note.
 *   2. Top-driver action: identifies the input contributing the most
 *      corrosion above the dataset baseline and states the corresponding
 *      operational lever, using wording consistent with RESULTS.md on
 *      what is and isn't actionable in this model.
 */
function renderExplanation(prediction) {
  const rate = prediction.corrosion_rate_mmpy;
  const contribs = prediction.contributions || [];

  let outlook;
  if (rate < 0.01) {
    outlook = (
      <>
        Predicted corrosion rate is effectively zero at these conditions —
        with the current inhibitor performance no meaningful wall loss is
        expected on operational timescales.
      </>
    );
  } else {
    const yearsToRetire = (WALL_MM * RETIREMENT_FRAC) / rate;
    const yearsToBreach = WALL_MM / rate;
    outlook = (
      <>
        At <strong>{rate.toFixed(2)} mm/year</strong>, a nominal 10&nbsp;mm
        carbon-steel wall would reach the 50% retirement threshold in about{" "}
        <strong>{formatYears(yearsToRetire)}</strong> and be fully consumed
        in about <strong>{formatYears(yearsToBreach)}</strong>, if these
        conditions persist.
      </>
    );
  }

  const topPositive = contribs.find((c) => c.delta_mmpy > 0.02);
  let action;
  if (!topPositive) {
    action = (
      <>
        None of the current inputs push the rate meaningfully above the
        dataset baseline — the recommendation is simply to keep conditions
        within this envelope.
      </>
    );
  } else {
    action = (
      <>
        Biggest driver above baseline: <strong>{topPositive.label}</strong>
        {" "}(contributing +{topPositive.delta_mmpy.toFixed(2)} mm/year).{" "}
        {ACTION_HINT[topPositive.key] ||
          `Moving ${topPositive.label.toLowerCase()} back toward its dataset baseline would be the largest available reduction.`}
      </>
    );
  }

  return (
    <div className="explanation">
      <p>{outlook}</p>
      <p>{action}</p>
      {prediction.outside_validated_range && (
        <p className="explanation-warn">
          One or more inputs sit outside the validated 30–50&nbsp;°C / pH
          3.8–4.0 envelope, so the wall-life numbers above are an
          extrapolation — treat them as indicative only.
        </p>
      )}
      <div className="note">
        Wall-life numbers assume a nominal 10&nbsp;mm carbon-steel wall and
        a 50% wall-loss retirement rule — swap in your line&apos;s real
        thickness and integrity policy for a project figure. This is a
        constant-conditions projection, not a remaining-life forecast.
      </div>
    </div>
  );
}
