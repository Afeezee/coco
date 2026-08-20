"use client";
import { useEffect, useRef } from "react";

const FEATURE_COLOR = "rgba(210,162,58,ALPHA)";
const INVERT_COLOR = "rgba(193,90,46,ALPHA)";

/**
 * Draws the pipe photo (or a default schematic if none uploaded) plus a
 * risk overlay. If `grounding` is provided (from /api/vision), feature
 * markers are placed at the real detected coordinates. Otherwise it falls
 * back to the illustrative default positions (bottom invert band + three
 * evenly spaced weld markers) used before a photo is analysed.
 *
 * This overlay is always a physically-motivated illustration scaled by the
 * model's predicted severity -- never a claim of pixel-level corrosion
 * detection. See README.md.
 */
export default function PipeCanvas({ image, grounding, severityFrac }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const draw = () => {
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!c || !wrap) return;
      c.width = wrap.clientWidth;
      c.height = wrap.clientHeight;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);

      if (image) {
        const iw = image.width, ih = image.height;
        const scale = Math.max(c.width / iw, c.height / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(image, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      } else {
        drawDefaultSchematic(ctx, c.width, c.height);
      }

      const rustAlpha = 0.18 + 0.55 * severityFrac;
      const amberAlpha = 0.15 + 0.5 * severityFrac;

      if (grounding && grounding.features && grounding.features.length > 0) {
        // Grounded mode: draw invert band only if orientation is horizontal
        // (matches the physical justification), and feature glows at the
        // vision model's real detected coordinates.
        if (grounding.orientation === "horizontal" || grounding.orientation === "inclined") {
          drawInvertBand(ctx, c.width, c.height, rustAlpha);
        }
        grounding.features.forEach((f) => {
          const gx = (f.x_pct / 100) * c.width;
          const gy = (f.y_pct / 100) * c.height;
          drawGlow(ctx, gx, gy, amberAlpha);
        });
        if (grounding.visible_anomalies) {
          grounding.visible_anomalies.forEach((a) => {
            const gx = (a.x_pct / 100) * c.width;
            const gy = (a.y_pct / 100) * c.height;
            drawAnomalyMarker(ctx, gx, gy);
          });
        }
      } else {
        // Default illustrative mode (no grounding yet)
        drawInvertBand(ctx, c.width, c.height, rustAlpha);
        [0.18, 0.5, 0.82].forEach((fx) => {
          drawGlow(ctx, c.width * fx, c.height * 0.5, amberAlpha);
        });
      }
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [image, grounding, severityFrac]);

  return (
    <div className="imgwrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function drawDefaultSchematic(ctx, w, h) {
  ctx.fillStyle = "#1a2126";
  ctx.fillRect(0, 0, w, h);
  const pipeTop = h * 0.28, pipeBot = h * 0.72;
  const grad = ctx.createLinearGradient(0, pipeTop, 0, pipeBot);
  grad.addColorStop(0, "#7c8790");
  grad.addColorStop(0.5, "#aab3ba");
  grad.addColorStop(1, "#5f6970");
  ctx.fillStyle = grad;
  ctx.fillRect(0, pipeTop, w, pipeBot - pipeTop);
  ctx.strokeStyle = "#3a4147";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, pipeTop, w, pipeBot - pipeTop);
  [0.18, 0.5, 0.82].forEach((fx) => {
    ctx.beginPath();
    ctx.moveTo(w * fx, pipeTop);
    ctx.lineTo(w * fx, pipeBot);
    ctx.strokeStyle = "rgba(20,24,27,0.55)";
    ctx.lineWidth = 6;
    ctx.stroke();
  });
}

function drawInvertBand(ctx, w, h, alpha) {
  const bandTop = h * 0.66, bandBot = h * 0.9;
  const grad = ctx.createLinearGradient(0, bandTop, 0, bandBot);
  grad.addColorStop(0, INVERT_COLOR.replace("ALPHA", "0"));
  grad.addColorStop(1, INVERT_COLOR.replace("ALPHA", String(alpha)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandTop, w, bandBot - bandTop);
}

function drawGlow(ctx, gx, gy, alpha) {
  const rg = ctx.createRadialGradient(gx, gy, 2, gx, gy, 30);
  rg.addColorStop(0, FEATURE_COLOR.replace("ALPHA", String(alpha)));
  rg.addColorStop(1, FEATURE_COLOR.replace("ALPHA", "0"));
  ctx.fillStyle = rg;
  ctx.fillRect(gx - 30, gy - 30, 60, 60);
}

function drawAnomalyMarker(ctx, gx, gy) {
  ctx.beginPath();
  ctx.arc(gx, gy, 6, 0, 2 * Math.PI);
  ctx.strokeStyle = "#e08a5c";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx - 9, gy);
  ctx.lineTo(gx + 9, gy);
  ctx.moveTo(gx, gy - 9);
  ctx.lineTo(gx, gy + 9);
  ctx.strokeStyle = "#e08a5c";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
