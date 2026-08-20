import { NextResponse } from "next/server";

/**
 * app/api/vision/route.js
 * -----------------------------------------------------------------------
 * Scene-grounding service. Takes an uploaded pipe photo and asks a
 * vision-capable model to identify:
 *   - pipe orientation (horizontal / vertical / inclined)
 *   - approximate relative-coordinate locations of welds/joints/flanges/
 *     elbows/supports
 *   - any visible EXTERNAL surface anomalies (rust staining, coating
 *     damage) -- reported separately, never blended into the internal
 *     corrosion-rate prediction from /api/predict.
 *
 * HARD CONSTRAINT: internal CO2 corrosion happens on the inside of the
 * pipe wall and is not visible in an external photo. This endpoint must
 * never be described as detecting corrosion -- it only locates where the
 * physics-based risk overlay should be drawn on THIS photo. Keep that
 * framing in any UI text that consumes this response.
 *
 * Uses the Anthropic API by default. To swap to another vision model
 * (e.g. Qwen-VL, Meta's Muse Spark), replace the fetch call below --
 * the rest of the route (prompt, response contract, caching guidance)
 * stays the same.
 * -----------------------------------------------------------------------
 */

const SYSTEM_PROMPT = `You are a scene-grounding assistant for a pipeline engineering tool.
You will be shown a photo of a section of steel pipe. You are NOT detecting
corrosion -- internal corrosion is invisible from outside the pipe. Your only
job is to describe the pipe's geometry and locate visible hardware features.

Respond with ONLY a JSON object (no markdown fences, no prose) in this exact
shape:
{
  "orientation": "horizontal" | "vertical" | "inclined" | "unclear",
  "features": [
    {"type": "weld" | "joint" | "flange" | "elbow" | "support" | "valve", "x_pct": 0-100, "y_pct": 0-100}
  ],
  "visible_anomalies": [
    {"description": "short description", "x_pct": 0-100, "y_pct": 0-100}
  ],
  "notes": "one short sentence, optional"
}
x_pct/y_pct are the feature's approximate position as a percentage of image
width/height (0,0 = top-left). If you cannot identify any features, return an
empty array for "features". If the image does not appear to show a pipe,
set "orientation" to "unclear" and explain briefly in "notes".`;

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { image_base64, media_type } = body;
  if (!image_base64 || !media_type) {
    return NextResponse.json(
      { error: "image_base64 and media_type are required" },
      { status: 400 }
    );
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(media_type)) {
    return NextResponse.json(
      { error: `Unsupported media_type: ${media_type}` },
      { status: 400 }
    );
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type, data: image_base64 },
            },
            {
              type: "text",
              text: "Analyse this pipe photo per the instructions.",
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Vision model request failed (${anthropicRes.status})`, detail: errText },
      { status: 502 }
    );
  }

  const data = await anthropicRes.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  const raw = textBlock ? textBlock.text : "";

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to a safe default rather than crashing the UI -- the
    // frontend should treat this the same as "no grounding available" and
    // fall back to the default illustrative zones.
    return NextResponse.json({
      orientation: "unclear",
      features: [],
      visible_anomalies: [],
      notes: "Could not parse vision model response as JSON.",
      raw_response: raw.slice(0, 500),
    });
  }

  return NextResponse.json(parsed);
}
