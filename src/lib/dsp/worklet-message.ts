export interface WorkletPortLike {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  postMessage(message: unknown): void;
  start?: () => void;
}

export interface WorkletNodeLike {
  port: WorkletPortLike;
}

export interface WorkletMessageOptions {
  label?: string;
  retryDelayMs?: number;
  retries?: number;
  timeoutMs?: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postWorkletMessageOnce(
  node: WorkletNodeLike,
  message: Record<string, unknown>,
  responseType: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      node.port.removeEventListener("message", onMessage);
    };

    const onMessage = (event: MessageEvent) => {
      if (
        settled ||
        event.data?.type !== responseType ||
        event.data?.ok === false
      ) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    node.port.start?.();
    node.port.addEventListener("message", onMessage);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${responseType} from ${label} after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    try {
      node.port.postMessage(message);
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error(`Unable to message ${label} audio worklet`),
      );
    }
  });
}

/**
 * Send a request/response message to an AudioWorklet port.
 *
 * AudioWorklet startup is asynchronous and can be delayed while other engines
 * are active. A short retry window handles a lost startup message or a delayed
 * first ACK without making normal initialization wait unnecessarily.
 */
export async function postWorkletMessage(
  node: WorkletNodeLike,
  message: Record<string, unknown>,
  responseType: string,
  options: WorkletMessageOptions = {},
): Promise<void> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 2000);
  const retries = Math.max(0, options.retries ?? 0);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const label = options.label ?? "audio worklet";
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await postWorkletMessageOnce(
        node,
        message,
        responseType,
        timeoutMs,
        label,
      );
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await wait(retryDelayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to message ${label} audio worklet`);
}
