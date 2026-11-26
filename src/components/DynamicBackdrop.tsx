import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { BgImageKey, BgTheme } from '../../shared/questions.ts';
import { getBackdropVisual } from '../utils/themeAssets.ts';

interface DynamicBackdropProps {
  theme: BgTheme;
  imageKey?: BgImageKey;
  motifLabel?: string;
  isUrgent?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

export function DynamicBackdrop({
  theme,
  imageKey,
  motifLabel,
  isUrgent = false,
}: DynamicBackdropProps) {
  const visual = getBackdropVisual(theme, imageKey);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [visual.image]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let rafId = 0;
    const particleCount = 28;
    const particles: Particle[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * (theme === 'tech' ? 0.55 : 0.28),
        vy: theme === 'science' ? -(0.25 + Math.random() * 0.4) : (Math.random() - 0.5) * 0.28,
        size: 1.5 + Math.random() * 2.5,
        alpha: 0.25 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      });
    }

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        p.phase += dt * 1.6;

        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;

        const twinkle = 0.65 + 0.35 * Math.sin(p.phase);
        ctx.globalAlpha = p.alpha * twinkle;
        ctx.fillStyle = visual.particleColor;

        if (theme === 'tech') {
          ctx.fillRect(p.x, p.y, p.size * 1.6, p.size * 1.6);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (theme === 'space' || theme === 'tech') {
        ctx.strokeStyle = visual.particleColor;
        ctx.lineWidth = 0.7;
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 15000) {
              ctx.globalAlpha = (1 - distSq / 15000) * 0.16;
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.stroke();
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [theme, visual.particleColor]);

  return (
    <div
      data-bg-key={visual.key}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Cross-fading question-specific artwork */}
      <AnimatePresence mode="sync">
        <motion.div
          key={visual.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          {!imgFailed ? (
            <img
              src={visual.image}
              alt={motifLabel || visual.label}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover animate-ken-burns opacity-80 dark:opacity-68"
            />
          ) : (
            <div className={`h-full w-full bg-gradient-to-br ${visual.glowGradient}`} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Contrast-safe readability scrim */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-100/74 via-slate-100/62 to-slate-200/80 dark:from-slate-950/65 dark:via-slate-950/50 dark:to-slate-950/80 transition-colors duration-300" />

      {/* Atmospheric particle canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Urgent red perimeter vignette in final 5 seconds */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          isUrgent ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          boxShadow: 'inset 0 0 90px rgba(239, 68, 68, 0.38)',
        }}
      />
    </div>
  );
}
