import type { ReactNode } from "react";
import s from "./ui.module.css";

export function Page({
  title,
  eyebrow,
  subtitle,
  actions,
  width = 960,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  width?: number | "full";
  children: ReactNode;
}) {
  return (
    <div
      className={s.page}
      style={{ maxWidth: width === "full" ? "none" : width + 96 }}
    >
      <header className={s.pageHeader}>
        <div className={s.pageTitle}>
          {eyebrow ? (
            <div className={`label-caps label-caps-zh ${s.pageEyebrow}`}>
              {eyebrow}
            </div>
          ) : null}
          <h1 className="display" style={{ fontSize: 32 }}>
            {title}
          </h1>
          {subtitle ? <p className={s.pageSubtitle}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={s.pageActions}>{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
