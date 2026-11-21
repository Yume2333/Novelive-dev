// 侧边栏外壳：全局导航（书库/用量/设置）+ 底部主题切换。
// M0 没有作品：不显示作品分区和全局制作状态。崩溃横幅全局置顶。
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { bridge } from "../api/bridge";
import { Icon } from "../components/Icon";
import s from "../components/ui.module.css";
import { type ThemeMode, useTheme } from "./theme";

function NavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `${s.navItem} ${isActive ? s.navItemActive : ""}`
      }
    >
      <Icon name={icon} size={19} />
      {label}
    </NavLink>
  );
}

function ThemeSwitch() {
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();
  const options: { value: ThemeMode; icon: string; title: string }[] = [
    { value: "light", icon: "light_mode", title: t("shell.themeLight") },
    { value: "dark", icon: "dark_mode", title: t("shell.themeDark") },
    { value: "system", icon: "contrast", title: t("shell.themeSystem") },
  ];
  return (
    <div className={s.themeSwitch}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => setMode(o.value)}
          className={`${s.themeOpt} ${mode === o.value ? s.themeOptActive : ""}`}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

/** 崩溃横幅：creator.down 显示日志位置 + 手动重启；creator.ready 后消失 */
function CrashBanner() {
  const { t } = useTranslation();
  const [down, setDown] = useState<{
    reason: string;
    willRestart: boolean;
    logDir: string;
  } | null>(null);
  useEffect(() => {
    const offDown = bridge().on("event:creator.down", (e) => {
      const ev = e as {
        event?: { reason?: string; willRestart?: boolean; logDir?: string };
        reason?: string;
        willRestart?: boolean;
        logDir?: string;
      };
      const inner = ev.event ?? ev;
      setDown({
        reason: String(inner.reason ?? ""),
        willRestart: !!inner.willRestart,
        logDir: String(inner.logDir ?? ""),
      });
    });
    const offReady = bridge().on("event:creator.ready", () => setDown(null));
    return () => {
      offDown();
      offReady();
    };
  }, []);
  if (!down) return null;
  return (
    <div className={s.banner} role="alert">
      <Icon name="warning" size={16} />
      <span className={s.bannerText}>
        {t("banner.creatorDown", { dir: down.logDir || "userData/logs" })}
        {down.reason ? `（${down.reason}）` : ""}
      </span>
      <button className={s.bannerBtn} onClick={() => bridge().openLogDir?.()}>
        {t("banner.restart") === "重新启动" ? "日志" : "Logs"}
      </button>
      {!down.willRestart ? (
        <button
          className={s.bannerBtn}
          onClick={() => void bridge().restartCreator?.()}
        >
          {t("banner.restart")}
        </button>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
  // 换页时回到顶部（无依赖数组：每次渲染后都滚回顶部，路由切换即换页）
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  });
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside className={`glass-panel ${s.sidebar}`}>
        <div className={s.brand}>
          <Icon
            name="auto_stories"
            size={22}
            style={{ color: "var(--color-primary)" }}
          />
          <span className={s.brandName}>NOVELIVE</span>
        </div>
        <nav className={s.nav}>
          <NavItem to="/" end icon="local_library" label={t("shell.library")} />
          <NavItem to="/usage" icon="monitoring" label={t("shell.usage")} />
          <NavItem to="/settings" icon="settings" label={t("shell.settings")} />
        </nav>
        <div style={{ flex: 1 }} />
        <div className={s.sidebarBottom}>
          <ThemeSwitch />
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <main
          ref={mainRef}
          style={{ position: "absolute", inset: 0, overflow: "auto" }}
        >
          <Outlet />
        </main>
        <CrashBanner />
      </div>
    </div>
  );
}
