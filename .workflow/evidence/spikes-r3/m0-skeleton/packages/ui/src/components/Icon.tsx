import type { CSSProperties, ReactNode } from "react";
import { lucideMap } from "./lucideMap";
import s from "./ui.module.css";

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const Lucide = lucideMap[name];
  if (!Lucide)
    return (
      <span className={s.iconWrap} style={style}>
        ?
      </span>
    );
  return (
    <span className={s.iconWrap} style={style}>
      <Lucide size={size * 0.92} strokeWidth={1.8} />
    </span>
  );
}

type ButtonVariant = "primary" | "neu" | "ghost" | "danger";

export function Button({
  variant = "neu",
  size,
  icon,
  children,
  onClick,
  disabled,
  style,
  title,
}: {
  variant?: ButtonVariant;
  size?: "sm";
  icon?: string;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
}) {
  const cls = [
    s.btn,
    size === "sm" ? s.btnSm : "",
    variant === "neu" ? "neu-button" : "",
    variant === "primary" ? s.btnPrimary : "",
    variant === "ghost" ? s.btnGhost : "",
    variant === "danger" ? s.btnDanger : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      className={cls}
      style={style}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 18} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className={s.spinner}>
      <Icon name="progress_activity" size={size} />
    </span>
  );
}
