"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Gauge from "../components/Gauge";
import PipeCanvas from "../components/PipeCanvas";

const DEFAULTS = {
  temperature_C: 40,
  flow_velocity_ms: 1.5,
  CO2_pressure_bar: 1.5,
  internal_pressure_bar: 65,
  shear_stress_Pa: 4,
  pH: 3.9,
  inhibitor_efficiency_pct: 50,
};

const SLIDER_CONFIG = [
  { key: "temperature_C", label: "Temperature", unit: "\u00B0C", min: 10, max: 70, step: 1 },
  { key: "flow_velocity_ms", label: "Flow velocity", unit: "m/s", min: 0.8, max: 2.2, step: 0.1 },
  { key: "CO2_pressure_bar", label: "CO2 partial pressure", unit: "bar", min: 0.4, max: 2.6, step: 0.1 },
  { key: "internal_pressure_bar", label: "Internal pressure", unit: "bar", min: 50, max: 80, step: 1 },
  { key: "shear_stress_Pa", label: "Shear stress", unit: "Pa", min: 1, max: 7, step: 0.1 },
  { key: "pH", label: "pH", unit: "", min: 3.0, max: 5.0, step: 0.05 },
  { key: "inhibitor_efficiency_pct", label: "Inhibitor efficiency", unit: "%", min: 0, max: 100, step: 1 },
];

const SEVERITY_COLOR = { low: "var(--safe)", medium: "var(--amber)", high: "var(--rust-1)" };

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
                </div>
              );
            })}
          </div>
          <div className="note">
            Estimated relative influence: each bar shows how much the prediction would shift if
            that input alone were reset to its typical dataset value, holding all others fixed.
            It approximates, but is not identical to, a full Shapley-value (SHAP) decomposition.
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
