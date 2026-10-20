const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "beom",
  Object.freeze({
    call: (method, params) => ipcRenderer.invoke("backend", method, params),
    file: (method, params) => ipcRenderer.invoke("file", method, params),
    state: (method, params) => ipcRenderer.invoke("state", method, params),
    flushDraft: (params) => ipcRenderer.sendSync("flush-profile", params),
    update: (method) => ipcRenderer.invoke("update", method),
    onEvent: (handler) => {
      const listener = (_event, value) => handler(value);
      ipcRenderer.on("beom-event", listener);
      return () => ipcRenderer.removeListener("beom-event", listener);
    },
  }),
);
