import { NextResponse } from "next/server";
const { predict, severityOf, contributions, rangeFlags } = require("../../../lib/model");

const REQUIRED_FIELDS = [
  "temperature_C",
  "flow_velocity_ms",
  "CO2_pressure_bar",
  "internal_pressure_bar",
  "shear_stress_Pa",
  "pH",
  "inhibitor_efficiency_pct",
];

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof body[field] !== "number" || Number.isNaN(body[field])) {
      return NextResponse.json(
        { error: `Missing or invalid numeric field: ${field}` },
        { status: 400 }
      );
    }
  }

  const rate = predict(body);
  const severity = severityOf(rate);
  const { flags, anyOut } = rangeFlags(body);
  const contribs = contributions(body);

  return NextResponse.json({
    corrosion_rate_mmpy: Number(rate.toFixed(3)),
    severity,
    range_flags: flags,
    outside_validated_range: anyOut,
    contributions: contribs.map((c) => ({
      key: c.key,
      label: c.label,
      delta_mmpy: Number(c.delta.toFixed(3)),
    })),
    model_scope: "CO2 (sweet) internal corrosion only -- see README for H2S future-work scope",
  });
}
