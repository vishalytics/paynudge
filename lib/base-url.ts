import { headers } from "next/headers";

/** Public URL of this deployment (used in reminder links and MCP results). */
export function baseUrlFromHeaders(h: Headers): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function baseUrl(): Promise<string> {
  return baseUrlFromHeaders(await headers());
}
