# CoCo: Corrosion Console

Explainable ML console for **CO2 (sweet) internal pipeline corrosion**. Next.js
14+/App Router, deployable to Vercel. This is the working implementation of
`deliverable_build_spec.md` from the project planning thread — read that file
for the full rationale behind every decision below.

## What it does

- 7 sliders for the model's real input features, each flagged the moment it
  leaves the range the model was actually trained on.
- A live corrosion-rate prediction (gauge + severity badge) from a real
  server-side model — a degree-2 polynomial regression fit to 243 real rows
  of CO2 sweet-corrosion data (R² ≈ 0.998–0.999 against the original
  scikit-learn model).
- A "what's driving this" panel — an honest one-at-a-time local sensitivity
  estimate, explicitly not claimed to be SHAP.
- Upload a pipe photo and a vision model (Claude, via the Anthropic API by
  default) locates real welds/joints/flanges/elbows and the pipe's
  orientation in *that specific photo*, and the risk overlay is drawn at
  those real coordinates instead of generic placeholder positions.

See [RESULTS.md](RESULTS.md) for full model validation (5-fold CV R²,
learning curve, feature importance, external-set finding, and the
polynomial-surrogate error check).

## Important: what the vision feature is and isn't

Internal CO2 corrosion happens on the inside of the pipe wall — no photo of
the outside of an intact pipe can show it, regardless of model quality. The
`/api/vision` route does **not** detect corrosion. It only locates pipe
geometry and hardware features (welds, joints, flanges, elbows, orientation)
so the physics-based risk zones can be drawn at the real positions in the
photo. If the model happens to notice visible external anomalies (rust
staining, coating damage), those are surfaced as a **separate** note in the
UI, never blended into the internal-corrosion-rate number. Keep this framing
if you extend the UI — it's the difference between a defensible tool and an
overclaiming one.

## Scope

CO2 (sweet) internal corrosion only. See `deliverable_build_spec.md` §2a for
exactly how H2S (mixed/sour corrosion) would be incorporated in future work —
it is deliberately not implemented here; the real H2S evidence available
(5 isolating data points) is far short of what the CO2 model needed to
converge (~190 rows).

## Project structure

```
app/
  page.js                 Main UI (client component)
  layout.js
  globals.css
  api/
    predict/route.js      Server-side prediction + contribution breakdown
    vision/route.js       Server-side vision grounding (Anthropic API)
components/
  Gauge.jsx                Canvas gauge
  PipeCanvas.jsx            Image + risk overlay renderer
lib/
  model.js                 The actual model: coefficients, validated ranges,
                            severity thresholds, contribution decomposition
```

## Local development

```bash
npm install
cp .env.example .env.local     # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. The prediction sliders work immediately with no
API key. The photo-upload feature needs `ANTHROPIC_API_KEY` set — without it,
`/api/vision` returns a clear config error and the UI falls back to the
default illustrative overlay positions, it does not crash.

Get a key at https://console.anthropic.com/. Swapping to a different vision
model (Qwen-VL, Meta's Muse Spark, etc.) only requires editing the fetch call
in `app/api/vision/route.js` — the request/response contract with the
frontend (`orientation`, `features[]`, `visible_anomalies[]`) stays the same.

## Deploying to Vercel

1. Push this project to a GitHub repository (Vercel deploys from Git):
   ```bash
   git init
   git add .
   git commit -m "Initial commit: pipeline corrosion risk console"
   git branch -M main
   git remote add origin <your-empty-github-repo-url>
   git push -u origin main
   ```
2. Go to https://vercel.com/new, sign in, and import that GitHub repository.
   Vercel auto-detects Next.js — no build settings need to change.
3. Before the first deploy (or in Project Settings → Environment Variables
   afterwards), add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com/
4. Click Deploy. Vercel gives you a live `https://<project>.vercel.app` URL
   within a couple of minutes.
5. Any push to `main` auto-redeploys.

That's the whole process — no server to manage, no Dockerfile needed, this is
a standard Next.js App Router project and Vercel is its default target.

## Validated domain of applicability

| Variable | Validated range |
|---|---|
| Temperature | 30–50°C |
| pH | 3.8–4.0 |
| CO2 partial pressure | 1.0–2.0 bar |
| Flow velocity | 1.2–1.8 m/s |
| Internal pressure | 60–70 bar |
| Inhibitor efficiency | 40–60% |
| Shear stress | 3–5 Pa |

Predictions outside this range are extrapolation, and the UI flags them —
do not remove that warning banner; it's carrying forward a real finding from
testing the model against an independent 17-row literature set, which showed
the model degrades badly outside this range.

## Testing notes (already verified before handoff)

- `npm run build` completes with no errors, 0 npm audit vulnerabilities.
- `/api/predict` verified: matches the original scikit-learn model to within
  ~0.075 mm/y on sampled points; correctly zeroes out at 100% inhibitor
  efficiency; correctly flags out-of-range inputs (tested at 90°C);
  correctly rejects malformed/incomplete requests with a clear error.
- `/api/vision` verified to fail gracefully (clear JSON error, not a crash)
  when `ANTHROPIC_API_KEY` is unset. End-to-end vision grounding needs a real
  key and a real photo to verify — do that once deployed.
