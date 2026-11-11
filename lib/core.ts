import { q } from "./db";
import { addDays, daysOverdue, inr, isValidDate, today } from "./dates";
import { newToken } from "./seed";

/**
 * All business rules live here. Both the web app and the MCP server call these
 * functions, so Claude and a human always go through the same logic.
 * There is no AI anywhere in this file: just data, dates and arithmetic.
 */

export type Actor = "claude" | "user" | "customer" | "system";

export const BUSINESS_NAME = process.env.BUSINESS_NAME || "Kaveri Packaging";
export const PAYMENT_UPI = process.env.PAYMENT_UPI || "kaveri.demo@upi";

export class AppError extends Error {}

export async function logActivity(invoiceId: number | null, actor: Actor, action: string, detail?: string | null) {
  await q("insert into activity (invoice_id, actor, action, detail) values ($1,$2,$3,$4)", [
    invoiceId, actor, action, detail ?? null,
  ]);
}

// ---------- reading ----------

const INVOICE_COLS = `
  i.id, i.invoice_number, i.amount, i.issue_date, i.due_date, i.status, i.paid_on, i.payment_ref,
  i.priority, i.strategy_note, i.notes, i.public_token, i.created_by, i.created_at, i.updated_at,
  c.id as customer_id, c.name as customer_name, c.contact_name, c.email, c.phone,
  (select min(r.send_on) from reminders r where r.invoice_id = i.id and r.status = 'scheduled') as next_reminder_on,
  (select count(*)::int from reminders r where r.invoice_id = i.id and r.status = 'scheduled') as scheduled_count,
  (select count(*)::int from reminders r where r.invoice_id = i.id and r.status = 'sent') as sent_count`;

export type Invoice = {
  id: number; invoice_number: string; amount: number; issue_date: string | null; due_date: string;
  status: "open" | "claimed" | "paid"; paid_on: string | null; payment_ref: string | null;
  priority: "low" | "medium" | "high" | null; strategy_note: string | null; notes: string | null;
  public_token: string; created_by: string; created_at: string; updated_at: string;
  customer_id: number; customer_name: string; contact_name: string | null; email: string | null; phone: string | null;
  next_reminder_on: string | null; scheduled_count: number; sent_count: number;
  days_overdue: number; state: "overdue" | "due_soon" | "not_due" | "claimed" | "paid";
};

function enrich(r: any): Invoice {
  const days = r.status === "paid" ? 0 : daysOverdue(r.due_date);
  let state: Invoice["state"];
  if (r.status === "paid") state = "paid";
  else if (r.status === "claimed") state = "claimed";
  else if (days > 0) state = "overdue";
  else if (days >= -7) state = "due_soon";
  else state = "not_due";
  return { ...r, amount: Number(r.amount), days_overdue: days, state };
}

export type ListFilter = "all" | "unpaid" | "overdue" | "claimed" | "paid";

export async function listInvoices(filter: ListFilter = "unpaid", customer?: string): Promise<Invoice[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter === "unpaid") where.push("i.status <> 'paid'");
  if (filter === "overdue") {
    params.push(today());
    where.push(`i.status = 'open' and i.due_date < $${params.length}`);
  }
  if (filter === "claimed") where.push("i.status = 'claimed'");
  if (filter === "paid") where.push("i.status = 'paid'");
  if (customer) {
    params.push(`%${customer.toLowerCase()}%`);
    where.push(`lower(c.name) like $${params.length}`);
  }
  const rows = await q(
    `select ${INVOICE_COLS} from invoices i join customers c on c.id = i.customer_id
     ${where.length ? "where " + where.join(" and ") : ""}
     order by (i.status = 'paid'), i.due_date asc`,
    params
  );
  return rows.map(enrich);
}

export async function findInvoice(ref: { invoice_id?: number; invoice_number?: string }): Promise<Invoice> {
  let rows: any[] = [];
  if (ref.invoice_id) {
    rows = await q(`select ${INVOICE_COLS} from invoices i join customers c on c.id = i.customer_id where i.id = $1`, [ref.invoice_id]);
  } else if (ref.invoice_number) {
    rows = await q(`select ${INVOICE_COLS} from invoices i join customers c on c.id = i.customer_id where lower(i.invoice_number) = lower($1)`, [ref.invoice_number.trim()]);
  }
  if (!rows.length) throw new AppError("Invoice not found. Use list_invoices to see valid invoice ids and numbers.");
  return enrich(rows[0]);
}

export async function getInvoiceByToken(token: string): Promise<Invoice | null> {
  const rows = await q(`select ${INVOICE_COLS} from invoices i join customers c on c.id = i.customer_id where i.public_token = $1`, [token]);
  return rows.length ? enrich(rows[0]) : null;
}

export type Reminder = {
  id: number; invoice_id: number; send_on: string; channel: "email" | "whatsapp"; tone: "friendly" | "firm" | "final";
  subject: string | null; message: string; status: "scheduled" | "sent" | "cancelled"; delivery: string | null;
  sent_at: string | null; created_by: string;
};

export async function getReminders(invoiceId: number): Promise<Reminder[]> {
  return q<Reminder>(
    "select * from reminders where invoice_id = $1 order by (status = 'cancelled'), send_on, id",
    [invoiceId]
  );
}

export async function getActivity(invoiceId?: number, limit = 40) {
  if (invoiceId) {
    return q("select * from activity where invoice_id = $1 order by created_at desc, id desc limit $2", [invoiceId, limit]);
  }
  return q(
    `select a.*, i.invoice_number, c.name as customer_name from activity a
     left join invoices i on i.id = a.invoice_id left join customers c on c.id = i.customer_id
     order by a.created_at desc, a.id desc limit $1`,
    [limit]
  );
}

/** How a customer has paid in the past: computed from their paid invoices. */
export async function customerHistory(customerId: number) {
  const rows = await q<{ invoice_number: string; amount: number; due_date: string; paid_on: string | null; status: string }>(
    "select invoice_number, amount, due_date, paid_on, status from invoices where customer_id = $1 order by due_date",
    [customerId]
  );
  const paid = rows.filter((r) => r.status === "paid" && r.paid_on);
  const lateness = paid.map((r) => daysOverdue(r.due_date, r.paid_on!));
  const avg = lateness.length ? Math.round(lateness.reduce((a, b) => a + b, 0) / lateness.length) : null;
  return {
    paid_invoices: paid.length,
    average_days_late_when_paying: avg,
    invoices: rows.map((r) => ({
      invoice_number: r.invoice_number,
      amount: Number(r.amount),
      due_date: r.due_date,
      status: r.status,
      paid_on: r.paid_on,
      days_late: r.paid_on ? daysOverdue(r.due_date, r.paid_on) : null,
    })),
  };
}

export async function summary() {
  const all = await listInvoices("all");
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const unpaid = all.filter((i) => i.status !== "paid");
  const overdue = unpaid.filter((i) => i.status === "open" && i.days_overdue > 0);
  const sum = (xs: Invoice[]) => xs.reduce((a, b) => a + b.amount, 0);
  const buckets = [
    { label: "Not yet due", min: -Infinity, max: 0 },
    { label: "1–15 days", min: 1, max: 15 },
    { label: "16–30 days", min: 16, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "60+ days", min: 61, max: Infinity },
  ].map((b) => {
    const xs = unpaid.filter((i) => i.status === "open" && i.days_overdue >= b.min && i.days_overdue <= b.max);
    return { label: b.label, amount: sum(xs), count: xs.length };
  });
  const recovered = all.filter((i) => i.status === "paid" && i.paid_on && i.paid_on >= monthStart);
  const [{ n: dueToday }] = await q<{ n: number }>(
    `select count(*)::int as n from reminders r join invoices i on i.id = r.invoice_id
     where r.status = 'scheduled' and r.send_on <= $1 and i.status = 'open'`,
    [t]
  );
  const noPlan = overdue.filter((i) => i.scheduled_count === 0);
  return {
    today: t,
    outstanding: sum(unpaid),
    outstanding_count: unpaid.length,
    overdue: sum(overdue),
    overdue_count: overdue.length,
    awaiting_confirmation: sum(unpaid.filter((i) => i.status === "claimed")),
    awaiting_confirmation_count: unpaid.filter((i) => i.status === "claimed").length,
    recovered_this_month: sum(recovered),
    recovered_this_month_count: recovered.length,
    reminders_due_today: dueToday,
    overdue_without_followup_plan: noPlan.map((i) => ({ invoice_id: i.id, invoice_number: i.invoice_number, customer: i.customer_name, amount: i.amount, days_overdue: i.days_overdue })),
    aging: buckets,
    top_overdue: [...overdue].sort((a, b) => b.amount * b.days_overdue - a.amount * a.days_overdue).slice(0, 5)
      .map((i) => ({ invoice_id: i.id, invoice_number: i.invoice_number, customer: i.customer_name, amount: i.amount, days_overdue: i.days_overdue })),
  };
}

// ---------- writing ----------

export type NewInvoice = {
  customer_name: string; contact_name?: string; email?: string; phone?: string;
  invoice_number: string; amount: number; issue_date?: string; due_date: string; notes?: string;
};

async function upsertCustomer(c: { customer_name: string; contact_name?: string; email?: string; phone?: string }) {
  const name = c.customer_name.trim();
  const existing = await q<{ id: number }>("select id from customers where lower(name) = lower($1)", [name]);
  if (existing.length) {
    await q(
      `update customers set contact_name = coalesce($2, contact_name), email = coalesce($3, email), phone = coalesce($4, phone) where id = $1`,
      [existing[0].id, c.contact_name || null, c.email || null, c.phone || null]
    );
    return existing[0].id;
  }
  const [r] = await q<{ id: number }>(
    "insert into customers (name, contact_name, email, phone) values ($1,$2,$3,$4) returning id",
    [name, c.contact_name || null, c.email || null, c.phone || null]
  );
  return r.id;
}

export async function addInvoices(items: NewInvoice[], actor: Actor) {
  const results: any[] = [];
  for (const it of items) {
    const label = it.invoice_number || "(no number)";
    if (!it.customer_name?.trim()) { results.push({ invoice_number: label, result: "skipped", reason: "customer_name is required" }); continue; }
    if (!it.invoice_number?.trim()) { results.push({ invoice_number: label, result: "skipped", reason: "invoice_number is required" }); continue; }
    const amount = Number(it.amount);
    if (!(amount > 0)) { results.push({ invoice_number: label, result: "skipped", reason: "amount must be a positive number (INR)" }); continue; }
    if (!isValidDate(it.due_date)) { results.push({ invoice_number: label, result: "skipped", reason: "due_date must be YYYY-MM-DD" }); continue; }
    if (it.issue_date && !isValidDate(it.issue_date)) { results.push({ invoice_number: label, result: "skipped", reason: "issue_date must be YYYY-MM-DD" }); continue; }
    const dup = await q("select id from invoices where lower(invoice_number) = lower($1)", [it.invoice_number.trim()]);
    if (dup.length) { results.push({ invoice_number: label, result: "skipped", reason: "already exists", invoice_id: dup[0].id }); continue; }

    const customerId = await upsertCustomer(it);
    const [r] = await q<{ id: number }>(
      `insert into invoices (customer_id, invoice_number, amount, issue_date, due_date, notes, public_token, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [customerId, it.invoice_number.trim(), amount, it.issue_date || null, it.due_date, it.notes || null, newToken(), actor]
    );
    await logActivity(r.id, actor, "Invoice added", `${it.invoice_number} · ${inr(amount)} · due ${it.due_date}`);
    const inv = await findInvoice({ invoice_id: r.id });
    results.push({
      invoice_id: inv.id, invoice_number: inv.invoice_number, customer: inv.customer_name, amount: inv.amount,
      due_date: inv.due_date, days_overdue: inv.days_overdue, result: "created",
    });
  }
  return results;
}

export type ReminderInput = {
  send_on: string; channel?: "email" | "whatsapp"; tone?: "friendly" | "firm" | "final"; subject?: string; message: string;
};

export async function setFollowupPlan(
  invoiceId: number,
  plan: { priority?: "low" | "medium" | "high"; strategy_note?: string; reminders: ReminderInput[] },
  actor: Actor
) {
  const inv = await findInvoice({ invoice_id: invoiceId });
  if (inv.status === "paid") throw new AppError(`${inv.invoice_number} is already paid; no follow-up needed.`);
  if (!plan.reminders?.length) throw new AppError("Provide at least one reminder.");
  if (plan.reminders.length > 6) throw new AppError("A plan can have at most 6 reminders.");
  const t = today();
  const notes: string[] = [];

  const cancelled = await q("update reminders set status = 'cancelled' where invoice_id = $1 and status = 'scheduled' returning id", [invoiceId]);
  const created: any[] = [];
  for (const r of plan.reminders) {
    if (!r.message?.trim()) throw new AppError("Every reminder needs a message.");
    let sendOn = isValidDate(r.send_on) ? r.send_on : t;
    if (sendOn < t) { notes.push(`A reminder dated ${r.send_on} was in the past, so it was moved to today.`); sendOn = t; }
    const channel = r.channel === "whatsapp" ? "whatsapp" : "email";
    const tone = ["friendly", "firm", "final"].includes(r.tone || "") ? r.tone : "friendly";
    const [row] = await q(
      `insert into reminders (invoice_id, send_on, channel, tone, subject, message, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, send_on, channel, tone`,
      [invoiceId, sendOn, channel, tone, r.subject || null, r.message.trim(), actor]
    );
    created.push(row);
  }
  await q(
    `update invoices set priority = coalesce($2, priority), strategy_note = coalesce($3, strategy_note), updated_at = now() where id = $1`,
    [invoiceId, plan.priority || null, plan.strategy_note || null]
  );
  const toneList = created.map((c) => `${c.tone} ${c.channel} on ${c.send_on}`).join(", ");
  await logActivity(invoiceId, actor, "Follow-up plan created", `${created.length} reminder(s): ${toneList}${cancelled.length ? ` (replaced ${cancelled.length})` : ""}`);
  return { invoice_number: inv.invoice_number, reminders_scheduled: created, replaced_previous: cancelled.length, notes };
}

export type InvoicePatch = {
  amount?: number; due_date?: string; notes?: string | null; priority?: "low" | "medium" | "high" | null;
  strategy_note?: string | null; status?: "open" | "paid"; payment_ref?: string;
  contact_name?: string; email?: string; phone?: string;
};

export async function updateInvoice(invoiceId: number, patch: InvoicePatch, actor: Actor) {
  const inv = await findInvoice({ invoice_id: invoiceId });
  const changes: string[] = [];

  if (patch.amount !== undefined && Number(patch.amount) !== inv.amount) {
    if (!(Number(patch.amount) > 0)) throw new AppError("amount must be positive");
    await q("update invoices set amount = $2 where id = $1", [invoiceId, Number(patch.amount)]);
    changes.push(`amount ${inr(inv.amount)} → ${inr(patch.amount)}`);
  }
  if (patch.due_date !== undefined && patch.due_date !== inv.due_date) {
    if (!isValidDate(patch.due_date)) throw new AppError("due_date must be YYYY-MM-DD");
    await q("update invoices set due_date = $2 where id = $1", [invoiceId, patch.due_date]);
    changes.push(`due date → ${patch.due_date}`);
  }
  if (patch.notes !== undefined && (patch.notes || null) !== inv.notes) {
    await q("update invoices set notes = $2 where id = $1", [invoiceId, patch.notes || null]);
    changes.push("notes updated");
  }
  if (patch.priority !== undefined && (patch.priority || null) !== inv.priority) {
    await q("update invoices set priority = $2 where id = $1", [invoiceId, patch.priority || null]);
    changes.push(`priority → ${patch.priority || "none"}`);
  }
  if (patch.strategy_note !== undefined && (patch.strategy_note || null) !== inv.strategy_note) {
    await q("update invoices set strategy_note = $2 where id = $1", [invoiceId, patch.strategy_note || null]);
    changes.push("strategy note updated");
  }
  const contactChanged =
    (patch.contact_name !== undefined && (patch.contact_name || null) !== inv.contact_name) ||
    (patch.email !== undefined && (patch.email || null) !== inv.email) ||
    (patch.phone !== undefined && (patch.phone || null) !== inv.phone);
  if (contactChanged) {
    await q("update customers set contact_name = $2, email = $3, phone = $4 where id = $1", [
      inv.customer_id,
      patch.contact_name !== undefined ? patch.contact_name || null : inv.contact_name,
      patch.email !== undefined ? patch.email || null : inv.email,
      patch.phone !== undefined ? patch.phone || null : inv.phone,
    ]);
    changes.push("customer contact updated");
  }

  if (patch.status === "paid" && inv.status !== "paid") {
    await q("update invoices set status = 'paid', paid_on = $2, payment_ref = coalesce($3, payment_ref) where id = $1", [
      invoiceId, today(), patch.payment_ref || null,
    ]);
    const stopped = await q("update reminders set status = 'cancelled' where invoice_id = $1 and status = 'scheduled' returning id", [invoiceId]);
    await logActivity(invoiceId, actor, "Marked as paid", [patch.payment_ref || inv.payment_ref, stopped.length ? `${stopped.length} pending reminder(s) stopped automatically` : null].filter(Boolean).join(" · ") || null);
  } else if (patch.status === "open" && inv.status !== "open") {
    await q("update invoices set status = 'open', paid_on = null where id = $1", [invoiceId]);
    await logActivity(invoiceId, actor, "Reopened", inv.status === "claimed" ? "Customer's payment claim not confirmed" : null);
  }

  if (changes.length) {
    await q("update invoices set updated_at = now() where id = $1", [invoiceId]);
    await logActivity(invoiceId, actor, "Invoice edited", changes.join(" · "));
  }
  return findInvoice({ invoice_id: invoiceId });
}

export async function customerClaimsPayment(token: string, reference: string) {
  const inv = await getInvoiceByToken(token);
  if (!inv) throw new AppError("Invoice not found");
  if (inv.status !== "open") return inv;
  await q("update invoices set status = 'claimed', payment_ref = $2, updated_at = now() where id = $1", [inv.id, reference || null]);
  await logActivity(inv.id, "customer", "Customer reported payment", reference || "No reference given");
  return getInvoiceByToken(token);
}

// ---------- reminders ----------

export async function addReminder(invoiceId: number, r: ReminderInput, actor: Actor) {
  await findInvoice({ invoice_id: invoiceId });
  const sendOn = isValidDate(r.send_on) && r.send_on >= today() ? r.send_on : today();
  await q(
    `insert into reminders (invoice_id, send_on, channel, tone, subject, message, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
    [invoiceId, sendOn, r.channel || "email", r.tone || "friendly", r.subject || null, r.message, actor]
  );
  await logActivity(invoiceId, actor, "Reminder added", `${r.tone || "friendly"} ${r.channel || "email"} on ${sendOn}`);
}

export async function updateReminder(id: number, r: Partial<ReminderInput>, actor: Actor) {
  const [cur] = await q<Reminder>("select * from reminders where id = $1", [id]);
  if (!cur) throw new AppError("Reminder not found");
  if (cur.status !== "scheduled") throw new AppError("Only scheduled reminders can be edited");
  const sendOn = r.send_on && isValidDate(r.send_on) ? (r.send_on < today() ? today() : r.send_on) : cur.send_on;
  await q(
    "update reminders set send_on = $2, channel = $3, tone = $4, subject = $5, message = $6 where id = $1",
    [id, sendOn, r.channel || cur.channel, r.tone || cur.tone, r.subject ?? cur.subject, r.message ?? cur.message]
  );
  await logActivity(cur.invoice_id, actor, "Reminder edited", `${r.tone || cur.tone} ${r.channel || cur.channel} on ${sendOn}`);
  return cur.invoice_id;
}

export async function cancelReminder(id: number, actor: Actor) {
  const [cur] = await q<Reminder>("update reminders set status = 'cancelled' where id = $1 and status = 'scheduled' returning *", [id]);
  if (cur) await logActivity(cur.invoice_id, actor, "Reminder cancelled", `${cur.tone} ${cur.channel} planned for ${cur.send_on}`);
  return cur?.invoice_id;
}

export function payLink(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/pay/${token}`;
}

async function deliver(rem: Reminder, inv: Invoice, baseUrl: string): Promise<string> {
  const link = payLink(baseUrl, inv.public_token);
  const body = `${rem.message}\n\nView invoice ${inv.invoice_number} and payment details: ${link}`;
  if (rem.channel === "whatsapp") return "whatsapp (simulated)";

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "PayNudge <onboarding@resend.dev>";
  // Safety for demos: route every real email to one inbox instead of the (fictional) customer.
  const to = process.env.EMAIL_OVERRIDE_TO || inv.email;
  if (!key || !to) return "email (simulated)";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: rem.subject || `Payment reminder: ${inv.invoice_number} (${inr(inv.amount)})`,
        text: body,
      }),
    });
    if (!res.ok) return `email (simulated, provider error ${res.status})`;
    return `email sent to ${to}`;
  } catch {
    return "email (simulated, provider unreachable)";
  }
}

async function sendOne(rem: Reminder, actor: Actor, baseUrl: string) {
  const inv = await findInvoice({ invoice_id: rem.invoice_id });
  const delivery = await deliver(rem, inv, baseUrl);
  await q("update reminders set status = 'sent', delivery = $2, sent_at = now() where id = $1", [rem.id, delivery]);
  await logActivity(rem.invoice_id, actor === "user" ? "user" : "system", "Reminder sent", `${rem.tone} ${delivery}`);
  return { reminder_id: rem.id, invoice_number: inv.invoice_number, customer: inv.customer_name, delivery };
}

/** Sends every scheduled reminder that is due (today or earlier) for invoices still unpaid. */
export async function runDueReminders(baseUrl: string, actor: Actor = "system") {
  const due = await q<Reminder>(
    `select r.* from reminders r join invoices i on i.id = r.invoice_id
     where r.status = 'scheduled' and r.send_on <= $1 and i.status = 'open' order by r.send_on, r.id`,
    [today()]
  );
  const sent = [];
  for (const r of due) sent.push(await sendOne(r, actor, baseUrl));
  return sent;
}

export async function sendReminderNow(id: number, baseUrl: string, actor: Actor) {
  const [rem] = await q<Reminder>("select * from reminders where id = $1 and status = 'scheduled'", [id]);
  if (!rem) throw new AppError("Reminder not found or already sent");
  return sendOne(rem, actor, baseUrl);
}

export { addDays, today };
