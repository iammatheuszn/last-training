import type { ReactNode } from 'react';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

export function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data de expiração inválida.');
  return date.toISOString();
}

export function Pill({ label, good = false }: { label: string; good?: boolean }) {
  return <span className={`pill${good ? ' pill--good' : ' pill--bad'}`}>{label}</span>;
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <article className="metric">
      <p className="metric__label">{label}</p>
      <p className="metric__value">{value}</p>
      {hint ? <p className="metric__hint">{hint}</p> : null}
    </article>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function TableHead({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr>{labels.map(label => <th key={label} scope="col">{label}</th>)}</tr>
    </thead>
  );
}
