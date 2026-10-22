import type { ReactNode } from 'react';
export default function Badge({ children, tone = 'neutral' }: {
  children: ReactNode; tone?: 'neutral' | 'success' | 'danger';
}) {
  return <span className={`badge badge-${tone}`}><span className="status-dot" />{children}</span>;
}
