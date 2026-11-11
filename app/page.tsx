import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getActivity, listInvoices, summary, type ListFilter } from "@/lib/core";
import { fmtDate, inr, inrShort } from "@/lib/dates";
import { ActivityFeed, Flash, PriorityPill, Shell, StatePill } from "./components";
import { ClickRow, LiveRefresh, Submit } from "./client";
import { resetDemoAction, runRemindersAction } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS: [ListFilter, string][] = [
  ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["claimed", "Claimed"], ["paid", "Paid"], ["all", "All"],
];
const AGING_COLORS = ["#c9c4b8", "#e2b764", "#d08a3c", "#c4553f", "#8f2a1b"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ f?: string; msg?: string; err?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const filter = (FILTERS.find(([k]) => k === sp.f)?.[0] || "unpaid") as ListFilter;
  const [s, invoices, activity] = await Promise.all([summary(), listInvoices(filter), getActivity(undefined, 10)]);
  const agingTotal = s.aging.reduce((a, b) => a + b.amount, 0) || 1;
  const fresh = (i: { created_by: string; created_at: string }) =>
    i.created_by === "claude" && Date.now() - new Date(i.created_at).getTime() < 30 * 60 * 1000;

  return (
    <Shell active="dashboard">
      <Flash msg={sp.msg} err={sp.err} />
      <div className="page-head">
        <div>
          <h1>Collections</h1>
          <p>Money your customers owe you, and what PayNudge is doing about it. <LiveRefresh /></p>
        </div>
        <div className="btn-row">
          <form action={runRemindersAction}>
            <Submit className="btn primary" pending="Sending…">
              Run today&apos;s reminders{s.reminders_due_today ? ` (${s.reminders_due_today})` : ""}
            </Submit>
          </form>
        </div>
      </div>

      <section className="grid kpis">
        <div className="card kpi">
          <div className="label">Outstanding</div>
          <div className="value num">{inrShort(s.outstanding)}</div>
          <div className="sub">{s.outstanding_count} unpaid invoice{s.outstanding_count === 1 ? "" : "s"}</div>
        </div>
        <div className="card kpi accent-red">
          <div className="label">Overdue</div>
          <div className="value num">{inrShort(s.overdue)}</div>
          <div className="sub">{s.overdue_count} invoice{s.overdue_count === 1 ? "" : "s"} past due date</div>
        </div>
        <div className="card kpi">
          <div className="label">Customer says paid</div>
          <div className="value num">{inrShort(s.awaiting_confirmation)}</div>
          <div className="sub">{s.awaiting_confirmation_count} waiting for you to confirm</div>
        </div>
        <div className="card kpi accent-green">
          <div className="label">Recovered this month</div>
          <div className="value num">{inrShort(s.recovered_this_month)}</div>
          <div className="sub">{s.recovered_this_month_count} invoice{s.recovered_this_month_count === 1 ? "" : "s"} paid</div>
        </div>
      </section>

      <section className="card card-body" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2>How late is the money?</h2>
          {s.overdue_without_followup_plan.length > 0 && (
            <span className="small" style={{ color: "var(--red)" }}>
              {s.overdue_without_followup_plan.length} overdue invoice{s.overdue_without_followup_plan.length > 1 ? "s have" : " has"} no follow-up plan. Ask Claude to set one up.
            </span>
          )}
        </div>
        <div className="aging" style={{ marginTop: 10 }}>
          {s.aging.map((b, i) => (
            <span key={b.label} style={{ width: `${(b.amount / agingTotal) * 100}%`, background: AGING_COLORS[i] }} />
          ))}
        </div>
        <div className="aging-legend">
          {s.aging.map((b, i) => (
            <div key={b.label}>
              <span className="dot" style={{ background: AGING_COLORS[i] }} />{b.label}
              <b className="num">{inr(b.amount)}</b>
            </div>
          ))}
        </div>
      </section>

      <div className="grid two-col">
        <section className="card">
          <div className="card-head">
            <h2>Invoices</h2>
            <div className="filters">
              {FILTERS.map(([k, label]) => (
                <Link key={k} href={k === "unpaid" ? "/" : `/?f=${k}`} className={k === filter ? "on" : ""}>{label}</Link>
              ))}
            </div>
          </div>
          {invoices.length === 0 ? (
            <div className="empty">Nothing here. Ask Claude to add your unpaid invoices.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="right">Amount</th>
                    <th>Status</th>
                    <th className="hide-sm">Priority</th>
                    <th className="hide-sm">Next reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <ClickRow key={i.id} href={`/invoices/${i.id}`} className={fresh(i) ? "fresh" : ""}>
                      <td className="cust">
                        <Link className="rowlink" href={`/invoices/${i.id}`}>{i.customer_name}</Link>
                        <small>
                          {i.invoice_number} · due {fmtDate(i.due_date)}
                          {fresh(i) && <> · <span className="actor claude">New from Claude</span></>}
                        </small>
                      </td>
                      <td className="right num" style={{ fontWeight: 600 }}>{inr(i.amount)}</td>
                      <td><StatePill inv={i} /></td>
                      <td className="hide-sm"><PriorityPill p={i.priority} /></td>
                      <td className="hide-sm small">
                        {i.status === "paid" ? <span className="muted">Paid {fmtDate(i.paid_on)}</span>
                          : i.status === "claimed" ? <span className="muted">Paused: confirm payment</span>
                          : i.next_reminder_on ? <>{fmtDate(i.next_reminder_on)} <span className="muted">· {i.scheduled_count} planned</span></>
                          : i.days_overdue > 0 ? <span style={{ color: "var(--red)" }}>No plan yet</span>
                          : <span className="muted">—</span>}
                      </td>
                    </ClickRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="card">
          <div className="card-head"><h2>Activity</h2></div>
          <ActivityFeed items={activity} showInvoice />
        </aside>
      </div>

      <form action={resetDemoAction} style={{ marginTop: 24, textAlign: "right" }}>
        <Submit className="btn ghost sm" pending="Resetting…">Reset demo data</Submit>
      </form>
    </Shell>
  );
}
