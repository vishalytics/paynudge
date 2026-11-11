import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppError, customerHistory, findInvoice, getActivity, getReminders, payLink } from "@/lib/core";
import { fmtDate, fmtDateTime, inr, today } from "@/lib/dates";
import { baseUrl } from "@/lib/base-url";
import { ActivityFeed, Flash, PriorityPill, Shell, StatePill } from "../../components";
import { CopyButton, Submit } from "../../client";
import {
  addReminderAction, cancelReminderAction, markPaid, reopenInvoice, saveInvoice, saveReminder, sendNowAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const TONE_LABEL: Record<string, string> = { friendly: "Friendly", firm: "Firm", final: "Final notice" };

export default async function InvoicePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireUser();
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  let inv;
  try {
    inv = await findInvoice({ invoice_id: id });
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const [reminders, activity, history, base] = await Promise.all([
    getReminders(id), getActivity(id, 30), customerHistory(inv.customer_id), baseUrl(),
  ]);
  const link = payLink(base, inv.public_token);
  const scheduled = reminders.filter((r) => r.status === "scheduled");
  const t = today();

  return (
    <Shell active="dashboard">
      <Link href="/" className="crumb">← All invoices</Link>
      <Flash msg={sp.msg} err={sp.err} />

      <div className="inv-head">
        <div>
          <div className="btn-row" style={{ marginBottom: 6 }}>
            <StatePill inv={inv} /> <PriorityPill p={inv.priority} />
            {inv.created_by === "claude" && <span className="actor claude">Added by Claude</span>}
          </div>
          <h1>{inv.customer_name}</h1>
          <div className="muted">{inv.invoice_number} · issued {fmtDate(inv.issue_date)} · due {fmtDate(inv.due_date)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="amount num">{inr(inv.amount)}</div>
          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
            <CopyButton text={link} label="Copy customer link" />
            <a className="btn sm" href={link} target="_blank">Customer view ↗</a>
          </div>
        </div>
      </div>

      {inv.status === "claimed" && (
        <div className="card card-body" style={{ marginBottom: 16, borderColor: "#c7d4f4", background: "#f5f8fe" }}>
          <div className="btn-row" style={{ justifyContent: "space-between" }}>
            <div>
              <b>{inv.contact_name || "The customer"} says this is paid.</b>{" "}
              <span className="muted">Reference: {inv.payment_ref || "none given"}. Reminders are paused until you confirm.</span>
            </div>
            <div className="btn-row">
              <form action={markPaid.bind(null, id)}>
                <input type="hidden" name="payment_ref" value={inv.payment_ref || ""} />
                <Submit className="btn green sm">Confirm payment received</Submit>
              </form>
              <form action={reopenInvoice.bind(null, id)}>
                <Submit className="btn sm">Not received, resume reminders</Submit>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="grid detail-col">
        <div>
          {inv.strategy_note && (
            <div className="strategy">
              <div className="t">Claude&apos;s plan</div>
              {inv.strategy_note}
            </div>
          )}

          <section className="card">
            <div className="card-head">
              <h2>Follow-up plan</h2>
              <span className="muted small">
                {scheduled.length ? `${scheduled.length} reminder${scheduled.length > 1 ? "s" : ""} scheduled · PayNudge sends them automatically` : "No reminders scheduled"}
              </span>
            </div>
            <div className="card-body">
              {reminders.length === 0 && inv.status !== "paid" && (
                <div className="callout" style={{ marginBottom: 12 }}>
                  No plan yet. In Claude, try: <i>&ldquo;Set up a follow-up plan for {inv.invoice_number}.&rdquo;</i> Or add a reminder yourself below.
                </div>
              )}
              {reminders.map((r) => (
                <div key={r.id} className={`rem ${r.status}`}>
                  <div className="rem-head">
                    <span className={`pill ${r.tone === "friendly" ? "not_due" : r.tone === "firm" ? "due_soon" : "overdue"}`}>{TONE_LABEL[r.tone]}</span>
                    <span className="small"><b>{r.channel === "email" ? "Email" : "WhatsApp"}</b> · {fmtDate(r.send_on)}{r.status === "scheduled" && r.send_on <= t ? " (due now)" : ""}</span>
                    {r.created_by === "claude" && <span className="actor claude">Written by Claude</span>}
                    <span className="small muted" style={{ marginLeft: "auto" }}>
                      {r.status === "sent" ? `Sent ${fmtDateTime(r.sent_at)} · ${r.delivery}` : r.status === "cancelled" ? "Cancelled" : "Scheduled"}
                    </span>
                  </div>
                  <div className="rem-body">
                    {r.status === "scheduled" ? (
                      <>
                        <form action={saveReminder.bind(null, id, r.id)}>
                          <div className="rem-grid">
                            <label className="f"><span>Send on</span><input className="in" type="date" name="send_on" defaultValue={r.send_on} min={t} /></label>
                            <label className="f"><span>Channel</span>
                              <select className="in" name="channel" defaultValue={r.channel}><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>
                            </label>
                            <label className="f"><span>Tone</span>
                              <select className="in" name="tone" defaultValue={r.tone}><option value="friendly">Friendly</option><option value="firm">Firm</option><option value="final">Final notice</option></select>
                            </label>
                          </div>
                          {r.channel === "email" && (
                            <label className="f"><span>Subject</span><input className="in" name="subject" defaultValue={r.subject || ""} /></label>
                          )}
                          <label className="f"><span>Message (the customer&apos;s payment link is added automatically)</span>
                            <textarea className="in" name="message" defaultValue={r.message} rows={5} />
                          </label>
                          <div className="btn-row">
                            <Submit className="btn primary sm" pending="Saving…">Save changes</Submit>
                            <button className="btn sm" formAction={sendNowAction.bind(null, id, r.id)}>Send now</button>
                            <button className="btn ghost sm danger" formAction={cancelReminderAction.bind(null, id, r.id)}>Cancel reminder</button>
                          </div>
                        </form>
                      </>
                    ) : (
                      <>
                        {r.subject && <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.subject}</div>}
                        <pre>{r.message}</pre>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {inv.status !== "paid" && (
                <details className="add" style={{ marginTop: 8 }}>
                  <summary>+ Add a reminder yourself</summary>
                  <form action={addReminderAction.bind(null, id)} style={{ marginTop: 12 }}>
                    <div className="rem-grid">
                      <label className="f"><span>Send on</span><input className="in" type="date" name="send_on" defaultValue={t} min={t} /></label>
                      <label className="f"><span>Channel</span>
                        <select className="in" name="channel"><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>
                      </label>
                      <label className="f"><span>Tone</span>
                        <select className="in" name="tone"><option value="friendly">Friendly</option><option value="firm">Firm</option><option value="final">Final notice</option></select>
                      </label>
                    </div>
                    <label className="f"><span>Subject (email)</span><input className="in" name="subject" /></label>
                    <label className="f"><span>Message</span><textarea className="in" name="message" rows={4} placeholder={`Hi ${inv.contact_name || ""}, a quick reminder about ${inv.invoice_number}…`} /></label>
                    <Submit className="btn sm">Add reminder</Submit>
                  </form>
                </details>
              )}
            </div>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h2>History</h2></div>
            <ActivityFeed items={activity} />
          </section>
        </div>

        <aside className="grid" style={{ gap: 16 }}>
          {inv.status === "open" && (
            <section className="card card-body">
              <h2 style={{ marginBottom: 10 }}>Got paid?</h2>
              <form action={markPaid.bind(null, id)}>
                <label className="f"><span>UTR / UPI reference (optional)</span><input className="in" name="payment_ref" placeholder="e.g. UTR 4471 2290 1183" /></label>
                <Submit className="btn green" pending="Saving…">Mark as paid</Submit>
                <p className="small muted" style={{ marginBottom: 0 }}>Stops every pending reminder automatically.</p>
              </form>
            </section>
          )}
          {inv.status === "paid" && (
            <section className="card card-body">
              <h2>Paid on {fmtDate(inv.paid_on)}</h2>
              <p className="muted small">{inv.payment_ref || "No reference recorded"}</p>
              <form action={reopenInvoice.bind(null, id)}><Submit className="btn sm">Reopen invoice</Submit></form>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h2>Invoice details</h2></div>
            <form action={saveInvoice.bind(null, id)} className="card-body">
              <div className="form-grid">
                <label className="f"><span>Amount (₹)</span><input className="in num" name="amount" type="number" min="1" step="any" defaultValue={inv.amount} required /></label>
                <label className="f"><span>Due date</span><input className="in" name="due_date" type="date" defaultValue={inv.due_date} required /></label>
              </div>
              <label className="f"><span>Priority</span>
                <select className="in" name="priority" defaultValue={inv.priority || ""}>
                  <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </label>
              <label className="f"><span>Contact person</span><input className="in" name="contact_name" defaultValue={inv.contact_name || ""} /></label>
              <div className="form-grid">
                <label className="f"><span>Email</span><input className="in" name="email" type="email" defaultValue={inv.email || ""} /></label>
                <label className="f"><span>WhatsApp</span><input className="in" name="phone" defaultValue={inv.phone || ""} /></label>
              </div>
              <label className="f"><span>Internal notes</span><textarea className="in" name="notes" rows={3} defaultValue={inv.notes || ""} /></label>
              <Submit className="btn primary" pending="Saving…">Save changes</Submit>
            </form>
          </section>

          <section className="card card-body">
            <h2 style={{ marginBottom: 10 }}>How {inv.customer_name} pays</h2>
            <dl className="kv">
              <dt>Past invoices</dt><dd>{history.paid_invoices} paid</dd>
              <dt>Usually pays</dt>
              <dd>{history.average_days_late_when_paying === null ? "No history yet"
                : history.average_days_late_when_paying <= 0 ? "On time"
                : `${history.average_days_late_when_paying} days late on average`}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
