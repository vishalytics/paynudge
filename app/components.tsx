import Link from "next/link";
import { logout } from "./actions";
import { BUSINESS_NAME, type Invoice } from "@/lib/core";
import { fmtDateTime } from "@/lib/dates";

export function Shell({ active, children }: { active: "dashboard" | "connect"; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">₹</span> PayNudge
          </Link>
          <span className="biz">{BUSINESS_NAME}</span>
          <nav className="nav">
            <Link href="/" className={active === "dashboard" ? "active" : ""}>Collections</Link>
            <Link href="/connect" className={active === "connect" ? "active" : ""}>Connect Claude</Link>
            <form action={logout}>
              <button className="btn ghost sm" type="submit">Log out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <div className="flash err">{err}</div>;
  if (msg) return <div className="flash">{msg}</div>;
  return null;
}

export function StatePill({ inv }: { inv: Pick<Invoice, "state" | "days_overdue"> }) {
  const d = inv.days_overdue;
  const label =
    inv.state === "paid" ? "Paid"
    : inv.state === "claimed" ? "Customer says paid"
    : inv.state === "overdue" ? `${d} day${d === 1 ? "" : "s"} overdue`
    : d === 0 ? "Due today"
    : `Due in ${-d} day${d === -1 ? "" : "s"}`;
  return <span className={`pill ${inv.state}`}>{label}</span>;
}

export function PriorityPill({ p }: { p: string | null }) {
  if (!p) return <span className="muted small">—</span>;
  return <span className={`pill ${p}`}>{p[0].toUpperCase() + p.slice(1)}</span>;
}

const ACTOR_LABEL: Record<string, string> = { claude: "Claude", user: "You", customer: "Customer", system: "PayNudge" };

export function ActivityFeed({ items, showInvoice }: { items: any[]; showInvoice?: boolean }) {
  if (!items.length) return <div className="empty">No activity yet.</div>;
  return (
    <ul className="feed">
      {items.map((a) => (
        <li key={a.id}>
          <div className="top">
            <span className={`actor ${a.actor}`}>{ACTOR_LABEL[a.actor] || a.actor}</span>
            <span className="what">{a.action}</span>
            <span className="when">{fmtDateTime(a.created_at)}</span>
          </div>
          {a.detail && <div className="detail">{a.detail}</div>}
          {showInvoice && a.invoice_id && (
            <Link className="ref" href={`/invoices/${a.invoice_id}`}>
              {a.invoice_number} · {a.customer_name} →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
