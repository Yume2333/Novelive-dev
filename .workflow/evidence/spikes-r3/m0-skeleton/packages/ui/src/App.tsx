import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./i18n";
import { bridge } from "./api/bridge";
import type { AppConfigOut } from "./api/types";
import { ToastProvider } from "./components/Toast";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsagePage } from "./pages/UsagePage";
import { AppShell } from "./shell/AppShell";
import { ThemeProvider } from "./shell/theme";

export function App() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    // 主题从配置读一次
    bridge()
      .call("config.get", {})
      .promise.then((r) => {
        const c = (r as { config?: AppConfigOut }).config;
        if (c?.interface?.theme) setTheme(c.interface.theme);
      })
      .catch(() => {});
  }, []);
  return (
    <ThemeProvider initialMode={theme}>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
