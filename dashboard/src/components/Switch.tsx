import { useId } from 'react';
export default function Switch({ label, description, checked, onChange, disabled = false }: {
  label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="switch-row"><div><label htmlFor={id}>{label}</label><p className="muted">{description}</p></div>
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label}
      className="switch" disabled={disabled} onClick={() => onChange(!checked)}><span /></button></div>;
}
