"use client";
import { useEffect, useRef } from "react";
export default function CardFireworks({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (
      !element ||
      !active ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const bounds = element.getBoundingClientRect(),
      w = bounds.width,
      h = bounds.height,
      ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(w * ratio);
    element.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    let frame = 0,
      burst = 0;
    const start = performance.now();
    let previous = start;
    let particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      color: string;
    }[] = [];
    const draw = (now: number) => {
      const elapsed = now - start,
        dt = Math.min((now - previous) / 16.67, 2);
      previous = now;
      ctx.clearRect(0, 0, w, h);
      if (elapsed > 250 + burst * 470 && burst < 4) {
        const x = w * (burst % 2 ? 0.8 : 0.2),
          y = Math.min(h * 0.42, 120) + (burst % 2) * 100;
        for (let i = 0; i < 36; i++) {
          const a = (i * Math.PI * 2) / 36,
            v = 1.4 + Math.random() * 2.4;
          particles.push({
            x,
            y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 1,
            color: i % 3 ? "#eeff35" : "#ff4a98",
          });
        }
        burst++;
      }
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.035 * dt;
        p.life -= 0.017 * dt;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 2, 4);
      }
      ctx.globalAlpha = 1;
      if (elapsed < 2800) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, w, h);
    };
  }, [active]);
  return (
    <canvas ref={canvas} className="player-card-fireworks" aria-hidden="true" />
  );
}
