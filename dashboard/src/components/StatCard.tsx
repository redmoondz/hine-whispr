import type { ReactNode } from 'react';
export default function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return <article className="stat-card"><p className="eyebrow">{label}</p><div className="stat-value">{value}</div><p className="muted">{detail}</p></article>;
}
