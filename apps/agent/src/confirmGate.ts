interface Pending {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

function key(requestId: string, toolCallId: string): string {
  return `${requestId}::${toolCallId}`;
}

export function waitForConfirm(
  requestId: string,
  toolCallId: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const k = key(requestId, toolCallId);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(k);
      resolve(false);
    }, timeoutMs);
    pending.set(k, {
      resolve: (approved) => {
        clearTimeout(timer);
        pending.delete(k);
        resolve(approved);
      },
      timer,
    });
  });
}

export function resolveConfirm(
  requestId: string,
  toolCallId: string,
  approved: boolean,
): boolean {
  const item = pending.get(key(requestId, toolCallId));
  if (!item) return false;
  item.resolve(approved);
  return true;
}

export function cancelRequestConfirms(requestId: string): void {
  for (const [k, item] of pending) {
    if (k.startsWith(`${requestId}::`)) {
      clearTimeout(item.timer);
      item.resolve(false);
      pending.delete(k);
    }
  }
}
