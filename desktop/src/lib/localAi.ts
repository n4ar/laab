import { addPluginListener, invoke } from "@tauri-apps/api/core";

/** The model that runs on the iPhone (see the local-ai plugin). */
export type ModelState = "missing" | "downloading" | "ready";

export const modelStatus = () => invoke<{ state: ModelState }>("plugin:local-ai|status").then((r) => r.state);
export const downloadModel = () => invoke<void>("plugin:local-ai|download");

export const onModelEvent = <T>(event: "progress" | "ready" | "failed", run: (payload: T) => void) =>
  addPluginListener<T>("local-ai", event, run);

/** How long a summary took, measured on the device. */
export interface SummaryStats {
  loadSeconds: number;
  firstTokenSeconds: number;
  /** From LiteRT-LM; absent if it had none to give. */
  tokens?: number;
  tokensPerSecond?: number;
}

export function statsLine(s: SummaryStats): string {
  const speed = s.tokens != null && s.tokensPerSecond != null ? ` · ${s.tokens} token ที่ ${s.tokensPerSecond.toFixed(0)} token/วิ` : "";
  return `โหลดโมเดล ${s.loadSeconds.toFixed(1)} วิ · คำแรก ${s.firstTokenSeconds.toFixed(1)} วิ${speed}`;
}

/** Runs on the device; `onText` gets the summary so far as it is written. */
export async function summarizeOnDevice(id: string, prompt: string, onText: (text: string) => void): Promise<SummaryStats> {
  const listener = await addPluginListener<{ id: string; text: string }>("local-ai", "chunk", (e) => {
    if (e.id === id) onText(e.text);
  });
  try {
    const { text, ...stats } = await invoke<{ text: string } & SummaryStats>("plugin:local-ai|summarize", { id, prompt });
    onText(text);
    return stats;
  } finally {
    await listener.unregister();
  }
}
