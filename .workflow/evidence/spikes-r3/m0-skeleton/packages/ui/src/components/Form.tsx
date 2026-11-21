import type { ReactNode } from "react";
import { Icon } from "./Icon";
import s from "./ui.module.css";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className={s.field}>
      <span className={`label-caps label-caps-zh ${s.fieldLabel}`}>
        {label}
      </span>
      {children}
      {hint ? <span className={s.fieldHint}>{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  readOnly,
  type = "text",
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: "text" | "password";
}) {
  return (
    <input
      type={type}
      className={s.input}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

export function CompactSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className={s.compactSelect}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className={`label-caps label-caps-zh ${s.sectionLabel}`}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  actions,
}: {
  icon: string;
  title: string;
  desc: string;
  actions?: ReactNode;
}) {
  return (
    <div className={s.emptyState}>
      <div className={`neu-button ${s.emptyIcon}`}>
        <Icon name={icon} size={28} />
      </div>
      <h4 className="headline" style={{ fontSize: 20 }}>
        {title}
      </h4>
      <p className={s.emptyDesc}>{desc}</p>
      {actions ? <div className={s.emptyActions}>{actions}</div> : null}
    </div>
  );
}
