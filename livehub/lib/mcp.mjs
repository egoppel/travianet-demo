/**
 * Minimal client for the LiveHub AI-Agents MCP endpoint (streamable HTTP).
 * Credentials: LIVEHUB_CLIENT_ID / LIVEHUB_CLIENT_SECRET.
 */
const DEFAULT_URL = "https://livehub.audiocodes.io/ai-framework-management/api/v1/mcp/";

export class LiveHub {
  constructor({ url = process.env.LIVEHUB_MCP_URL || DEFAULT_URL, clientId = process.env.LIVEHUB_CLIENT_ID, clientSecret = process.env.LIVEHUB_CLIENT_SECRET } = {}) {
    if (!clientId || !clientSecret) throw new Error("LIVEHUB_CLIENT_ID and LIVEHUB_CLIENT_SECRET must be set");
    this.url = url;
    this.headers = {
      "X-Client-Id": clientId,
      "X-Client-Secret": clientSecret,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    this.sessionId = null;
    this.nextId = 1;
  }

  async #post(body) {
    const headers = { ...this.headers };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok && res.status !== 202) throw new Error(`LiveHub MCP HTTP ${res.status}: ${await res.text()}`);
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await res.text();
    if (!text) return null;
    const events = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
    return events.length ? events.at(-1) : JSON.parse(text);
  }

  async connect() {
    await this.#post({
      jsonrpc: "2.0", id: this.nextId++, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "travianet-provision", version: "1" } },
    });
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    return this;
  }

  /** Calls a tool; returns parsed JSON when possible. Throws on tool errors. */
  async call(name, args = {}) {
    const msg = await this.#post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } });
    if (msg?.error) throw new Error(`${name}: ${msg.error.message}`);
    const text = (msg?.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    if (msg?.result?.isError) throw new Error(`${name}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

/** Loads KEY=VALUE pairs from a .env file into process.env (without overriding). */
export async function loadDotEnv(path) {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env) && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
