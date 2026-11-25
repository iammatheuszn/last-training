import { useEffect, useRef } from 'react';

export default function Reticle() {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    const stage = element?.parentElement;
    if (!stage) return undefined;

    const move = event => {
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      element.style.opacity = '1';
    };
    const leave = () => {
      element.style.opacity = '0';
    };

    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div ref={ref} className="stage-reticle" aria-hidden="true">
      <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor">
        <path d="M26 0v15M26 37v15M0 26h15M37 26h15" strokeWidth="1" />
        <circle cx="26" cy="26" r="4.5" strokeWidth="1" />
        <circle cx="26" cy="26" r="1" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
