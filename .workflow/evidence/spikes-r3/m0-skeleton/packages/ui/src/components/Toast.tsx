import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { Icon } from "./Icon";
import s from "./ui.module.css";

interface ToastItem {
  id: number;
  text: string;
  icon?: string;
}
const ToastContext = createContext<(text: string, icon?: string) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, icon?: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, icon }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={s.toastStack}>
        {items.map((t) => (
          <div key={t.id} className={`glass-panel ${s.toast}`}>
            {t.icon ? <Icon name={t.icon} size={16} /> : null}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
