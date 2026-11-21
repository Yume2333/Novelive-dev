import type { CSSProperties, ReactNode } from "react";
import s from "./ui.module.css";

export function Card({
  children,
  style,
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div className={`glass-panel ${s.card}`} style={style} onClick={onClick}>
      {children}
    </div>
  );
}
