import { addPluginListener, invoke } from "@tauri-apps/api/core";

/** The model that runs on the iPhone (see the local-ai plugin). */
export type ModelState = "missing" | "downloading" | "ready";

export const modelStatus = () => invoke<{ state: ModelState }>("plugin:local-ai|status").then((r) => r.state);
export const downloadModel = () => invoke<void>("plugin:local-ai|download");

export const onModelEvent = <T>(event: "progress" | "ready" | "failed", run: (payload: T) => void) =>
  addPluginListener<T>("local-ai", event, run);

/** Runs on the device; `onText` gets the summary so far as it is written. */
export async function summarizeOnDevice(id: string, prompt: string, onText: (text: string) => void) {
  const listener = await addPluginListener<{ id: string; text: string }>("local-ai", "chunk", (e) => {
    if (e.id === id) onText(e.text);
  });
  try {
    const { text } = await invoke<{ text: string }>("plugin:local-ai|summarize", { id, prompt });
    onText(text);
  } finally {
    await listener.unregister();
  }
}
