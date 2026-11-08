import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolCall } from "@5tick/shared";

const execAsync = promisify(exec);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".vscode-test",
  "coverage",
]);

function resolveSafe(workspaceRoot: string, relativePath = "."): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath || ".");
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return target;
}

async function walkFiles(dir: string, acc: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 8 || acc.length > 5000) return acc;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, acc, depth + 1);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

/** Snapshot file content before a write (null if missing). */
export async function peekFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | null> {
  const filePath = resolveSafe(workspaceRoot, relativePath);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function runTool(
  workspaceRoot: string,
  call: ToolCall,
): Promise<string> {
  const args = call.arguments;

  switch (call.name) {
    case "read_file": {
      const filePath = resolveSafe(workspaceRoot, String(args.path ?? ""));
      const content = await fs.readFile(filePath, "utf8");
      if (content.length > 200_000) {
        return content.slice(0, 200_000) + "\n\n[truncated]";
      }
      return content;
    }
    case "write_file": {
      const filePath = resolveSafe(workspaceRoot, String(args.path ?? ""));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(args.content ?? ""), "utf8");
      return `Wrote ${path.relative(workspaceRoot, filePath)} (${String(args.content ?? "").length} bytes)`;
    }
    case "list_dir": {
      const dirPath = resolveSafe(workspaceRoot, String(args.path ?? "."));
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? "dir" : "file"}\t${e.name}`)
        .join("\n");
    }
    case "search": {
      const query = String(args.query ?? "").toLowerCase();
      if (!query) return "Empty query";
      const base = resolveSafe(workspaceRoot, String(args.path ?? "."));
      const maxResults = Number(args.maxResults ?? 40);
      const files = await walkFiles(base);
      const hits: string[] = [];
      for (const file of files) {
        if (hits.length >= maxResults) break;
        let text: string;
        try {
          const buf = await fs.readFile(file);
          if (buf.includes(0)) continue;
          text = buf.toString("utf8");
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            hits.push(
              `${path.relative(workspaceRoot, file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`,
            );
            if (hits.length >= maxResults) break;
          }
        }
      }
      return hits.length ? hits.join("\n") : "No matches";
    }
    case "run_terminal": {
      const command = String(args.command ?? "").trim();
      if (!command) return "Empty command";
      const blocked = [
        /rm\s+-rf\s+[\\/]/i,
        /format\s+[a-z]:/i,
        /del\s+\/s/i,
        /Remove-Item\s+.*-Recurse/i,
        /rd\s+\/s/i,
        /mkfs/i,
        /diskpart/i,
        /shutdown/i,
        /reg\s+delete/i,
        /curl\s+[^\n]*\|\s*sh/i,
        /Invoke-Expression/i,
        /iex\s*\(/i,
      ];
      if (blocked.some((re) => re.test(command))) {
        return "Blocked potentially destructive command";
      }
      const cwd = resolveSafe(workspaceRoot, String(args.cwd ?? "."));
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
          timeout: 60_000,
          maxBuffer: 2_000_000,
        });
        const out = [stdout, stderr].filter(Boolean).join("\n").trim();
        return out.slice(0, 40_000) || "(no output)";
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").slice(0, 40_000);
      }
    }
    case "web_fetch": {
      return webFetch(String(args.url ?? ""), Number(args.maxChars ?? 12_000));
    }
    case "web_search": {
      return webSearch(String(args.query ?? ""), Number(args.maxResults ?? 5));
    }
    default:
      return `Unknown tool: ${call.name}`;
  }
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) {
    return true;
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function classicPivots(high: number, low: number, close: number): string {
  const pp = (high + low + close) / 3;
  const r1 = 2 * pp - low;
  const s1 = 2 * pp - high;
  const r2 = pp + (high - low);
  const s2 = pp - (high - low);
  const r3 = high + 2 * (pp - low);
  const s3 = low - 2 * (high - pp);
  const range = high - low;
  const fR1 = pp + 0.382 * range;
  const fR2 = pp + 0.618 * range;
  const fR3 = pp + 1.0 * range;
  const fS1 = pp - 0.382 * range;
  const fS2 = pp - 0.618 * range;
  const fS3 = pp - 1.0 * range;
  return [
    `Prior session H=${round2(high)} L=${round2(low)} C=${round2(close)}`,
    `Classic pivots:`,
    `  PP=${round2(pp)}`,
    `  R1=${round2(r1)}  R2=${round2(r2)}  R3=${round2(r3)}`,
    `  S1=${round2(s1)}  S2=${round2(s2)}  S3=${round2(s3)}`,
    `Fibonacci pivots:`,
    `  PP=${round2(pp)}`,
    `  R1=${round2(fR1)}  R2=${round2(fR2)}  R3=${round2(fR3)}`,
    `  S1=${round2(fS1)}  S2=${round2(fS2)}  S3=${round2(fS3)}`,
  ].join("\n");
}

/**
 * Optional MetaTrader / MT5 Manager (or any Meta price) HTTP API.
 * Configure in .env:
 *   FIVETICK_MT5_API_BASE=https://your-gateway
 *   FIVETICK_MT5_API_KEY=...
 *   FIVETICK_MT5_SYMBOL=XAUUSD
 * Expected flexible JSON: { bid|ask|price|last, high, low, close, open }
 * or { bars: [{ high, low, close, open }, ...] } / { ohlc: [...] }
 */
async function fetchMt5Bundle(symbol = "XAUUSD"): Promise<string | null> {
  const base = (process.env.FIVETICK_MT5_API_BASE || "").replace(/\/$/, "");
  if (!base) return null;
  const key = process.env.FIVETICK_MT5_API_KEY || "";
  const sym = process.env.FIVETICK_MT5_SYMBOL || symbol;
  const pricePath = process.env.FIVETICK_MT5_PRICE_PATH || "/price";
  const ohlcPath = process.env.FIVETICK_MT5_OHLC_PATH || "/ohlc";
  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    Accept: "application/json",
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers["X-API-Key"] = key;
  }
  const lines: string[] = [
    `MT5 / Meta API feed`,
    `Symbol: ${sym}`,
    `At: ${new Date().toISOString()}`,
    `Base: ${base}`,
  ];

  try {
    const priceUrl = `${base}${pricePath}?symbol=${encodeURIComponent(sym)}`;
    const pr = await fetch(priceUrl, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (pr.ok) {
      const j = (await pr.json()) as Record<string, unknown>;
      const bid = Number(j.bid ?? j.Bid ?? NaN);
      const ask = Number(j.ask ?? j.Ask ?? NaN);
      const last = Number(j.price ?? j.last ?? j.Last ?? j.close ?? j.Close ?? NaN);
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        lines.push(`Bid=${round2(bid)} Ask=${round2(ask)} Mid=${round2((bid + ask) / 2)}`);
      } else if (Number.isFinite(last)) {
        lines.push(`Last/price=${round2(last)}`);
      } else {
        lines.push(`Price JSON: ${JSON.stringify(j).slice(0, 400)}`);
      }
    } else {
      lines.push(`Price HTTP ${pr.status}`);
    }
  } catch (err) {
    lines.push(`Price failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const ohlcUrl = `${base}${ohlcPath}?symbol=${encodeURIComponent(sym)}&timeframe=D1&count=5`;
    const or = await fetch(ohlcUrl, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (or.ok) {
      const j = (await or.json()) as Record<string, unknown>;
      const barsRaw = (j.bars || j.ohlc || j.candles || j.data || j) as unknown;
      const bars = Array.isArray(barsRaw) ? barsRaw : [];
      const norm = bars
        .map((b) => {
          const row = b as Record<string, unknown>;
          return {
            high: Number(row.high ?? row.High ?? row.h),
            low: Number(row.low ?? row.Low ?? row.l),
            close: Number(row.close ?? row.Close ?? row.c),
            open: Number(row.open ?? row.Open ?? row.o),
          };
        })
        .filter(
          (b) =>
            Number.isFinite(b.high) &&
            Number.isFinite(b.low) &&
            Number.isFinite(b.close),
        );
      if (norm.length >= 2) {
        const prior = norm[norm.length - 2]!;
        lines.push(classicPivots(prior.high, prior.low, prior.close));
      } else if (norm.length === 1) {
        const b = norm[0]!;
        lines.push(classicPivots(b.high, b.low, b.close));
      }
    } else {
      lines.push(`OHLC HTTP ${or.status}`);
    }
  } catch (err) {
    lines.push(`OHLC failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return lines.join("\n");
}

/** Live gold / XAUUSD — prefer MT5 Meta API when configured, else public feeds. */
export async function fetchXauUsdBundle(): Promise<string> {
  const lines: string[] = [
    `Live XAU/USD / gold quote bundle`,
    `At: ${new Date().toISOString()}`,
    `Note: investing.com frequently blocks bots (HTTP 403). Prefer MT5 Meta API or Yahoo.`,
  ];

  // 0) Your MetaTrader / Manager gateway (best for "same as broker" prices)
  try {
    const mt5 = await fetchMt5Bundle("XAUUSD");
    if (mt5) {
      lines.push(mt5);
      return lines.join("\n");
    }
  } catch (err) {
    lines.push(`MT5 API failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1) Yahoo Finance gold futures GC=F
  try {
    const yUrl =
      "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=10d";
    const res = await fetch(yUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; currency?: string; symbol?: string };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              open?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
    const result = j.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    if (price != null) {
      lines.push(
        `Yahoo Finance GC=F (gold futures ≈ XAUUSD): ${round2(price)} ${result?.meta?.currency || "USD"}`,
      );
      lines.push(`Source: https://finance.yahoo.com/quote/GC=F`);
    }
    const quote = result?.indicators?.quote?.[0];
    const closes = (quote?.close || []).filter((x): x is number => typeof x === "number");
    const highs = (quote?.high || []).filter((x): x is number => typeof x === "number");
    const lows = (quote?.low || []).filter((x): x is number => typeof x === "number");
    if (closes.length >= 2 && highs.length >= 2 && lows.length >= 2) {
      // Prior completed day = second-to-last bar
      const i = closes.length - 2;
      lines.push(classicPivots(highs[i]!, lows[i]!, closes[i]!));
    }
  } catch (err) {
    lines.push(`Yahoo GC=F failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2) goldprice.org JSON
  try {
    const res = await fetch("https://data-asg.goldprice.org/dbXRates/USD", {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await res.json()) as {
      items?: Array<{ xauPrice?: number; curr?: string }>;
      date?: string;
    };
    const item = j.items?.[0];
    if (item?.xauPrice != null) {
      lines.push(
        `goldprice.org XAU spot: ${round2(item.xauPrice)} ${item.curr || "USD"} (asof ${j.date || "n/a"})`,
      );
      lines.push(`Source: https://goldprice.org/`);
    }
  } catch (err) {
    lines.push(`goldprice.org failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3) metals.live spot gold
  try {
    const res = await fetch("https://api.metals.live/v1/spot/gold", {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const j = (await res.json()) as unknown;
      lines.push(`metals.live gold: ${JSON.stringify(j).slice(0, 300)}`);
      lines.push(`Source: https://api.metals.live/v1/spot/gold`);
    }
  } catch {
    /* optional */
  }

  return lines.join("\n");
}

async function webFetch(urlRaw: string, maxChars: number): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlRaw);
  } catch {
    return "Invalid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http/https URLs are allowed";
  }
  if (isPrivateHost(url.hostname)) {
    return "Blocked private/local URL (SSRF protection)";
  }

  // Investing.com blocks datacenter IPs — auto-fallback to live gold APIs
  if (
    /investing\.com/i.test(url.hostname) &&
    /xau|gold|currencies\/xau/i.test(url.pathname + urlRaw)
  ) {
    const bundle = await fetchXauUsdBundle();
    return `Investing.com is blocked for automated clients (usually HTTP 403).\nServing alternate live feeds instead:\n\n${bundle}`;
  }

  const limit = Math.min(Math.max(maxChars || 12_000, 500), 40_000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      redirect: "follow",
      headers: BROWSER_HEADERS,
    });
    const ctype = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!res.ok) {
      if (
        res.status === 403 &&
        /investing\.com/i.test(url.hostname) &&
        /xau|gold/i.test(url.pathname + url.search)
      ) {
        return `Investing.com HTTP 403 (bot block).\n\n${await fetchXauUsdBundle()}`;
      }
      return `HTTP ${res.status} from ${url.hostname}: ${htmlToText(raw).slice(0, 500)}`;
    }
    const text = ctype.includes("json")
      ? raw
      : ctype.includes("text/plain")
        ? raw
        : htmlToText(raw);
    const body = text.slice(0, limit);
    return `URL: ${url.toString()}\nFetched: ${new Date().toISOString()}\n\n${body}${text.length > limit ? "\n\n[truncated]" : ""}`;
  } catch (err) {
    return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function webSearch(query: string, maxResults: number): Promise<string> {
  const q = query.trim();
  if (!q) return "Empty query";
  const n = Math.min(Math.max(maxResults || 5, 1), 10);

  // Gold / XAU / XAUSD typo → structured live quote (best path)
  if (/xau|xausd|gold|pivot/i.test(q)) {
    const bundle = await fetchXauUsdBundle();
    return `Search: ${q}\n\n${bundle}\n\nAlso useful:\n- https://finance.yahoo.com/quote/GC=F\n- https://goldprice.org/\n- https://www.investing.com/currencies/xau-usd (may 403 for bots)`;
  }

  const lines: string[] = [`Search: ${q}`, `At: ${new Date().toISOString()}`];

  // 1) DuckDuckGo Instant Answer API
  try {
    const ddg = new URL("https://api.duckduckgo.com/");
    ddg.searchParams.set("q", q);
    ddg.searchParams.set("format", "json");
    ddg.searchParams.set("no_html", "1");
    ddg.searchParams.set("skip_disambig", "1");
    const res = await fetch(ddg.toString(), {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      Answer?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    if (data.Heading) lines.push(`Heading: ${data.Heading}`);
    if (data.Answer) lines.push(`Answer: ${data.Answer}`);
    if (data.AbstractText) {
      lines.push(`Abstract: ${data.AbstractText}`);
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
    }
    let count = 0;
    for (const t of data.RelatedTopics || []) {
      if (count >= n) break;
      if (t.Text && t.FirstURL) {
        lines.push(`- ${t.Text} (${t.FirstURL})`);
        count++;
      }
    }
    if (lines.length > 2) return lines.join("\n");
  } catch {
    /* fall through */
  }

  // 2) DuckDuckGo HTML
  try {
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(htmlUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const results: string[] = [];
    const re =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < n) {
      const href = m[1];
      const title = htmlToText(m[2]);
      if (href && title) results.push(`- ${title}\n  ${href}`);
    }
    if (results.length) {
      return [...lines, ...results].join("\n");
    }
  } catch (err) {
    lines.push(`DDG HTML failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3) Wikipedia opensearch as last resort
  try {
    const wiki = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=${n}&namespace=0&format=json`;
    const res = await fetch(wiki, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as [string, string[], string[], string[]];
    const titles = data[1] || [];
    const urls = data[3] || [];
    for (let i = 0; i < titles.length; i++) {
      lines.push(`- ${titles[i]}\n  ${urls[i]}`);
    }
    if (titles.length) return lines.join("\n");
  } catch {
    /* ignore */
  }

  return `${lines.join("\n")}\nNo web results. For gold/XAUUSD use Yahoo GC=F or goldprice.org (Investing.com often returns 403).`;
}
