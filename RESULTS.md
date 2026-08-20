# Model validation results

Benchmarks below come from the model's development against the 243-row real
CO2 sweet-corrosion dataset (`co2_h2s_primary_training_dataset.csv`). That
CSV is **not** shipped in this repo — only the trained model's coefficients
were ported into [lib/model.js](lib/model.js). These numbers are the record
of what that fit achieved, not something re-computed at runtime.

## Primary model benchmarks (243-row real CO2 sweet-corrosion dataset)

Algorithm comparison (80/20 holdout, random_state=42):
- Random Forest:  R² = 0.993, MAE = 0.075 mm/y
- XGBoost:        R² = 0.998, MAE = 0.045 mm/y

Cross-validation (Random Forest, 5-fold): R² = 0.995 mean (fold range 0.993–0.997)
-> Report the 5-fold CV result as the headline accuracy metric, not the
   single holdout split, since it uses all 243 rows across folds.

Learning curve (Random Forest, 5-fold CV, at increasing training size):
  n=19   R²=-0.22   n=97   R²=0.87   n=155  R²=0.98
  n=38   R²=-0.08   n=116  R²=0.94   n=174  R²=0.99
  n=58   R²=0.01    n=135  R²=0.96   n=194  R²=0.995
-> Flat by ~n=190. This is why 243 rows was judged sufficient: more rows
   sampled from the same range would not improve the model further. The
   real limitation is the narrow validated domain, not row count.

## Feature importance / explainability

Random Forest (impurity-based importance):
  inhibitor_efficiency_pct  0.362
  temperature_C             0.261
  CO2_pressure_bar          0.252
  pH                        0.113
  flow_velocity_ms          0.005
  shear_stress_Pa           0.005
  internal_pressure_bar     0.001

XGBoost (mean |SHAP value|), ranked:
  1. CO2 partial pressure  (highest)
  2. Temperature           (high)
  3. Inhibitor efficiency  (high)
  4. Flow velocity         (low)
  5. Internal pressure     (low)
  6. pH                    (very low)
  7. Shear stress          (~0)

NOTE THE DISCREPANCY: RF and SHAP disagree on pH's importance (0.113 vs.
"very low") and on the exact ordering of the top 3. Report this honestly in
the thesis discussion as a limitation/methodological note — do not smooth
it over or silently pick whichever ranking looks cleaner.

## External validation finding (out of scope for training, discussion only)

An independent 17-row literature dataset (not included in this repo) was
used to sanity-check generalisation. The model performed poorly on it
because that set spans a much wider range (temperature 25-250C, pH 3-6.6)
than the training data (temperature 30-50C, pH 3.8-4.0). This is expected
tree/regression-model extrapolation failure, not a bug -- it's the basis for
the validated-domain warnings built into the UI (lib/model.js VALID_RANGE).

## Extended-range synthetic dataset (discussion/future-work only, not used in this app's live model)

A wider-range synthetic dataset (2,000 rows) was generated from a de
Waard-Milliards-style model calibrated against the real 243-row data
(R² = 0.962 fit). It was deliberately capped at 90C because CO2 corrosion
has a known turnover around 60-80C (protective FeCO3 scale formation) that a
simple log-linear model can't represent -- extending further needs an added
scale-formation correction term, which is future work, not implemented here.

## Polynomial surrogate verification (this IS what's running in lib/model.js)

The degree-2 polynomial regression embedded in `lib/model.js` was checked
against the original scikit-learn-trained model it was derived from: max
absolute error ~0.075 mm/y on a 10-point sample, consistent with the
surrogate's own fit quality (R² ~ 0.998–0.999). This is the number already
mentioned in [README.md](README.md) — RESULTS.md cross-references it here so
all the validation evidence lives in one place.
