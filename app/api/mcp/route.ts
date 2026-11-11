import { AppError } from "@/lib/core";
import { TOOLS, callTool } from "@/lib/mcp-tools";
import { baseUrlFromHeaders } from "@/lib/base-url";

/**
 * Remote MCP server (Streamable HTTP transport, stateless, JSON responses).
 * Claude POSTs JSON-RPC messages here; we answer initialize, tools/list and tools/call.
 * No AI model is called anywhere: Claude calls us, never the other way round.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVER_INFO = { name: "paynudge", title: "PayNudge", version: "0.1.0" };
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "PayNudge chases unpaid invoices for a small business. You (Claude) read the user's invoice lists, judge each customer, " +
  "and write the reminder messages; PayNudge stores them, sends reminders on schedule, hosts a payment page for each " +
  "customer, and stops reminders when an invoice is paid. Typical flow: get_collections_summary → add_invoices (from what " +
  "the user shares) → get_invoice for history → create_followup_plan for each overdue invoice. Amounts are INR; dates YYYY-MM-DD.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Accept",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

type RpcMsg = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

async function handle(msg: RpcMsg, base: string) {
  const id = msg.id;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      try {
        const data = await callTool(name, args, base);
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false });
      } catch (e: any) {
        const message = e instanceof AppError ? e.message : "PayNudge hit an unexpected error. Please try again.";
        if (!(e instanceof AppError)) console.error("[mcp] tool error", name, e);
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

function authorised(req: Request) {
  const key = process.env.MCP_KEY;
  if (!key) return true;
  const url = new URL(req.url);
  return url.searchParams.get("key") === key || req.headers.get("authorization") === `Bearer ${key}`;
}

export async function POST(req: Request) {
  if (!authorised(req)) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or missing key" } }, 401);
  let body: RpcMsg | RpcMsg[];
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const base = baseUrlFromHeaders(req.headers);
  const msgs = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const m of msgs) {
    if (m.id === undefined || m.id === null) continue; // notification: no response
    responses.push(await handle(m, base));
  }
  if (!responses.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? responses : responses[0]);
}

export async function GET() {
  // We don't offer a server-initiated SSE stream.
  return new Response("PayNudge MCP endpoint. Add this URL to Claude as a custom connector.", {
    status: 405,
    headers: { Allow: "POST", ...CORS },
  });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
