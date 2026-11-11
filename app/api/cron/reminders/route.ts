import { runDueReminders } from "@/lib/core";
import { baseUrlFromHeaders } from "@/lib/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Called daily by Vercel Cron: sends every reminder that is due today. Works with no one logged in. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sent = await runDueReminders(baseUrlFromHeaders(req.headers), "system");
  return Response.json({ sent: sent.length, details: sent });
}
