import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}>({ mode: "system", setMode: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function apply(mode: ThemeMode) {
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({
  initialMode = "system",
  onModeChange,
  children,
}: {
  initialMode?: ThemeMode;
  onModeChange?: (m: ThemeMode) => void;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    onModeChange?.(m);
  };
  useEffect(() => {
    apply(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);
  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
