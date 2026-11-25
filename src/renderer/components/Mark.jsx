export default function Mark({ size = 34, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <rect x="0.75" y="0.75" width="38.5" height="38.5" strokeWidth="1.5" />
      <path d="M20 3v11M20 26v11M3 20h11M26 20h11" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
