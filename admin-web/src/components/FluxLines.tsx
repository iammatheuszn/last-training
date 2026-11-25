import { useEffect, useRef } from 'react';

export default function FluxLines() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let frame = 0;
    let width = 0;
    let height = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      const parent = canvas?.parentElement;
      if (!canvas || !parent) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(time: number) {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const t = reduced ? 0 : time / 1000;
      const lines = 17;
      for (let index = 0; index < lines; index += 1) {
        const base = (index / (lines - 1)) * height;
        const phase = t * 0.32 + index * 0.41;
        const amplitude = 18 + Math.sin(index * 1.7 + t * 0.15) * 12;
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 12) {
          const y = base
            + Math.sin(x * 0.006 + phase) * amplitude
            + Math.sin(x * 0.017 - phase * 0.7) * (amplitude * 0.35);
          if (x === -20) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        const alpha = 0.06 + (Math.sin(index * 0.9 + t * 0.25) + 1) * 0.045;
        context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        context.lineWidth = index % 4 === 0 ? 1.2 : 0.6;
        context.stroke();
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    }

    resize();
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    if (canvas?.parentElement) observer.observe(canvas.parentElement);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="flux-lines" aria-hidden="true" />;
}
