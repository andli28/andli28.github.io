// The page's side of the real model. The model itself (Qwen 3 0.6B on
// ExecuTorch's WebGPU backend) loads and runs in model-worker.js, so nothing
// here blocks the page. Nothing loads until this is called.

import { REAL } from "./llm.js";

/**
 * Start the worker, load the model and return a model adapter:
 *   { name, real, chat(messages, { max, onToken, signal }) → { text, in, out } }
 * Aborting `signal` stops that reply in the worker; the chat then rejects.
 * onProgress({ stage, loaded, total }) reports the load. `stage` is
 * "download", "cache" (everything was already in the browser) or "gpu".
 * onDead(message) is called if the worker stops after it had loaded.
 */
export function executorch(onProgress = () => {}, onDead = () => {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.isSecureContext || !navigator.gpu)
      return reject(new Error("this browser doesn't have WebGPU"));
    const worker = new Worker(new URL("./model-worker.js", import.meta.url));
    const waiting = new Map(); // chat id → { resolve, reject, onToken }
    let ready = false;
    let dead = null;
    let n = 0;
    const fail = message => {
      const e = new Error(message);
      // the worker holds the runtime and the model: let go of it
      worker.terminate();
      dead = e;
      if (!ready) reject(e);
      else onDead(message);
      for (const w of waiting.values()) w.reject(e);
      waiting.clear();
    };
    worker.onerror = ev => fail(ev.message || "the model worker stopped");
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (data.type === "progress") onProgress(data);
      else if (data.type === "ready") {
        ready = true;
        resolve({
          name: REAL.name,
          real: true,
          chat(messages, { max, onToken, signal } = {}) {
            return new Promise((res, rej) => {
              if (dead) return rej(dead);
              if (signal?.aborted) return rej(new Error("cancelled"));
              const id = ++n;
              waiting.set(id, { resolve: res, reject: rej, onToken });
              signal?.addEventListener(
                "abort",
                () =>
                  waiting.has(id) && worker.postMessage({ type: "cancel", id }),
                { once: true }
              );
              worker.postMessage({
                type: "chat",
                id,
                // role and content are all the model is sent
                messages: messages.map(m => ({
                  role: m.role,
                  content: m.content,
                })),
                max,
              });
            });
          },
        });
      } else if (data.type === "token") w?.onToken?.(data.text);
      else if (data.type === "result") {
        waiting.delete(data.id);
        w?.resolve({ text: data.text, in: data.in, out: data.out });
      } else if (data.type === "error") {
        if (data.id == null) fail(data.message);
        else {
          waiting.delete(data.id);
          w?.reject(new Error(data.message));
        }
      }
    };
    worker.postMessage({ type: "load" });
  });
}
