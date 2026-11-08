type Level = "info" | "warn" | "error";

function stamp(): string {
  return new Date().toISOString();
}

export function log(level: Level, message: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  const line = `[5Tick] ${stamp()} ${level.toUpperCase()} ${message}${payload}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
