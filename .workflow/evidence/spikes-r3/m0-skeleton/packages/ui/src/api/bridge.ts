// window.novelive 的统一入口：Electron 由 preload 注入；浏览器开发模式由 dev-bridge 客户端注入。
export interface CommandError {
  code:
    | "network"
    | "auth"
    | "not_found"
    | "invalid_config"
    | "cancelled"
    | "creator_down"
    | "internal";
  message: string;
}

export interface CallHandle {
  promise: Promise<unknown>;
  cancel: () => void;
}

export interface NoveliveBridge {
  call(command: string, payload: unknown): CallHandle;
  on(event: string, handler: (envelope: unknown) => void): () => void;
  resourceUrl(path: string): string;
  pickFolder(): Promise<string | null>;
  logDir?(): Promise<string>;
  openLogDir?(): Promise<void>;
  restartCreator?(): Promise<void>;
  appState?(): Promise<unknown>;
}

declare global {
  interface Window {
    novelive?: NoveliveBridge;
  }
}

export function bridge(): NoveliveBridge {
  if (!window.novelive) {
    // 浏览器开发模式下由 dev-bridge 客户端负责挂 window.novelive；
    // 这里兜底一个报错桥，避免界面崩溃。
    return {
      call: () => ({
        promise: Promise.reject({
          code: "creator_down",
          message: "bridge 未注入",
        } satisfies CommandError),
        cancel: () => {},
      }),
      on: () => () => {},
      resourceUrl: (p) => p,
      pickFolder: async () => null,
    };
  }
  return window.novelive;
}
