"use client";
import { useEffect, useRef } from "react";

export default function Gauge({ rate }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height, cx = w / 2, cy = h - 16, r = 140;
    ctx.clearRect(0, 0, w, h);

    const zones = [
      [0, 3, "#4f9c8e"],
      [3, 5.5, "#d2a23a"],
      [5.5, 10, "#c15a2e"],
    ];
    const maxV = 10;
    zones.forEach(([a, b, col]) => {
      const a0 = Math.PI + (a / maxV) * Math.PI;
      const a1 = Math.PI + (b / maxV) * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.lineWidth = 18;
      ctx.strokeStyle = col;
      ctx.lineCap = "butt";
      ctx.stroke();
    });

    const frac = Math.min(rate, maxV) / maxV;
    const ang = Math.PI + frac * Math.PI;
    const nx = cx + Math.cos(ang) * (r - 24);
    const ny = cy + Math.sin(ang) * (r - 24);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#eae7e0";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
    ctx.fillStyle = "#eae7e0";
    ctx.fill();
  }, [rate]);

  return <canvas ref={canvasRef} width={360} height={200} style={{ maxWidth: "100%" }} />;
}
