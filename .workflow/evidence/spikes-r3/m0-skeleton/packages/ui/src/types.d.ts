// window.novelive 形状声明：dev-bridge 客户端和 preload 都满足它。
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
