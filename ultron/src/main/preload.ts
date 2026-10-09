import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type Callback = (...args: unknown[]) => void;

const electron = {
  send: (channel: string, data?: unknown) => {
    ipcRenderer.send(channel, data);
  },
  invoke: (channel: string, data?: unknown) => ipcRenderer.invoke(channel, data),
  on: (channel: string, callback: Callback) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld('electron', electron);

export type ElectronBridge = typeof electron;
