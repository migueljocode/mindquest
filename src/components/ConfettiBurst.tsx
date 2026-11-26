import { useEffect, useRef } from 'react';

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  vRot: number;
  color: string;
}

const COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#a855f7'];

export function ConfettiBurst({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces: ConfettiPiece[] = [];
    for (let i = 0; i < 90; i++) {
      const fromLeft = i % 2 === 0;
      pieces.push({
        x: fromLeft ? canvas.width * 0.2 : canvas.width * 0.8,
        y: canvas.height * 0.65,
        vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 8) + (Math.random() - 0.5) * 4,
        vy: -(8 + Math.random() * 11),
        size: 6 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        color: COLORS[i % COLORS.length],
      });
    }

    let rafId = 0;
    let frames = 0;

    const loop = () => {
      frames += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let anyVisible = false;

      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.vx *= 0.99;
        p.rotation += p.vRot;

        if (p.y < canvas.height + 30) {
          anyVisible = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, 1 - frames / 180);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.55);
          ctx.restore();
        }
      }

      if (anyVisible && frames < 190) {
        rafId = requestAnimationFrame(loop);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      aria-hidden="true"
    />
  );
}
