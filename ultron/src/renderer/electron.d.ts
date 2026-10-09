export interface ElectronBridge {
  send(channel: string, data?: unknown): void;
  invoke(channel: string, data?: unknown): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

export {};
