/**
 * Shared TransformerDevice type and utilities used by both local-embeddings
 * and the cross-encoder reranker.
 */

export type TransformerDevice =
  | "auto"
  | "gpu"
  | "cpu"
  | "wasm"
  | "webgpu"
  | "cuda"
  | "dml"
  | "webnn"
  | "webnn-npu"
  | "webnn-gpu"
  | "webnn-cpu";

const TRANSFORMER_DEVICES: readonly string[] = [
  "auto",
  "gpu",
  "cpu",
  "wasm",
  "webgpu",
  "cuda",
  "dml",
  "webnn",
  "webnn-npu",
  "webnn-gpu",
  "webnn-cpu",
];

function isTransformerDevice(value: string): value is TransformerDevice {
  return TRANSFORMER_DEVICES.includes(value);
}

/**
 * Resolve the preferred inference device based on env var and platform.
 * Pass `runtimeFallbackDevice` from the caller so this stays pure.
 */
export function resolvePreferredDevice(
  runtimeFallbackDevice: TransformerDevice | null
): TransformerDevice {
  if (runtimeFallbackDevice) return runtimeFallbackDevice;

  const configured = process.env.LOCAL_EMBEDDING_DEVICE?.trim().toLowerCase();
  if (configured && isTransformerDevice(configured)) return configured;

  if (process.platform === "win32") return "dml";
  if (process.platform === "linux" && process.arch === "x64") return "cuda";
  return "cpu";
}

export function isRecoverableGpuRuntimeError(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return (
    message.includes("device instance has been suspended") ||
    message.includes("getdeviceremovedreason") ||
    message.includes("dxgi_error_device_removed") ||
    message.includes("dxgi_error_device_hung") ||
    message.includes("887a0005")
  );
}
