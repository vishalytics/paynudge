import { requireUser } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { TOOLS } from "@/lib/mcp-tools";
import { Shell } from "../components";
import { CopyButton } from "../client";

export const dynamic = "force-dynamic";

const PROMPTS = [
  "Here's my list of unpaid invoices [attach Excel / screenshot]. Add them to PayNudge and set up follow-ups for everyone who's overdue.",
  "Who owes me the most right now, and what's the plan for each of them?",
  "Sharma Traders always pays late. Make their follow-up firmer and add a final notice next week.",
  "FitFuel says they paid INV-2039. Mark it as paid, ref UTR 4471 2290 1183.",
];

export default async function ConnectPage() {
  await requireUser();
  const base = await baseUrl();
  const key = process.env.MCP_KEY;
  const url = `${base}/api/mcp${key ? `?key=${key}` : ""}`;

  return (
    <Shell active="connect">
      <div className="page-head">
        <div>
          <h1>Connect Claude</h1>
          <p>PayNudge has no AI inside. You bring your own Claude: it reads, judges and writes; PayNudge stores, schedules and chases.</p>
        </div>
      </div>
      <div className="grid detail-col">
        <section className="card card-body">
          <h2 style={{ marginBottom: 10 }}>Your MCP connector URL</h2>
          <div className="copyrow" style={{ marginBottom: 18 }}>
            <code className="code">{url}</code>
            <CopyButton text={url} />
          </div>
          <h2 style={{ marginBottom: 10 }}>Add it to Claude (about a minute)</h2>
          <ol className="steps">
            <li>Open <b>claude.ai</b> → <b>Settings</b> → <b>Connectors</b>.</li>
            <li>Click <b>Add custom connector</b>. Name it <b>PayNudge</b> and paste the URL above. No sign-in is needed.</li>
            <li>In a new chat, open the <b>+</b> menu → <b>Connectors</b> and make sure <b>PayNudge</b> is switched on.</li>
            <li>Ask Claude something from the list on the right. When it asks to use a PayNudge tool, click <b>Allow</b>.</li>
            <li>Keep this app open: the Collections page updates live as Claude works.</li>
          </ol>
          <div className="callout" style={{ marginTop: 14 }}>
            Custom connectors need a Claude plan that supports them (in Settings → Connectors you should see <b>Add custom connector</b>).
          </div>
        </section>

        <aside className="grid" style={{ gap: 16 }}>
          <section className="card card-body">
            <h2 style={{ marginBottom: 10 }}>Try asking Claude</h2>
            {PROMPTS.map((p) => <div key={p} className="prompt">{p}</div>)}
          </section>
          <section className="card card-body">
            <h2 style={{ marginBottom: 10 }}>What Claude can do here</h2>
            <dl className="kv" style={{ gridTemplateColumns: "1fr" }}>
              {TOOLS.map((t) => (
                <div key={t.name} style={{ marginBottom: 8 }}>
                  <dt><code>{t.name}</code></dt>
                  <dd className="small" style={{ color: "var(--ink-2)" }}>{t.title}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
