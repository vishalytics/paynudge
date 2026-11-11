import {
  AppError, addInvoices, customerHistory, findInvoice, getActivity, getReminders, listInvoices, payLink,
  setFollowupPlan, summary, today, updateInvoice, type ListFilter,
} from "./core";

/**
 * The "menu" PayNudge offers to Claude over MCP.
 * Claude does the reading, judging and writing; these tools only store, compute and schedule.
 */

const date = { type: "string", description: "Date as YYYY-MM-DD" };
const invoiceRef = {
  invoice_id: { type: "integer", description: "PayNudge invoice id (from list_invoices)" },
  invoice_number: { type: "string", description: "Invoice number, e.g. INV-2041 (used if invoice_id is not given)" },
};

export const TOOLS = [
  {
    name: "get_collections_summary",
    title: "Collections summary",
    description:
      "Start here. Returns today's date (India), money outstanding and overdue, ageing buckets, amount recovered this month, " +
      "reminders due today, the biggest overdue invoices, and overdue invoices that have no follow-up plan yet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_invoices",
    title: "Add unpaid invoices",
    description:
      "Save one or more unpaid invoices to PayNudge (for example, rows you read from the user's Excel export, Tally screenshot or pasted list). " +
      "Customers are matched by name or created. Duplicate invoice numbers are skipped. Amounts are in INR. " +
      "After adding, consider calling create_followup_plan for each overdue invoice.",
    inputSchema: {
      type: "object",
      properties: {
        invoices: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Business name of the customer who owes money" },
              contact_name: { type: "string", description: "Person to address reminders to" },
              email: { type: "string" },
              phone: { type: "string", description: "WhatsApp / phone number" },
              invoice_number: { type: "string" },
              amount: { type: "number", description: "Amount due in INR" },
              issue_date: date,
              due_date: date,
              notes: { type: "string", description: "Anything the user said about this invoice" },
            },
            required: ["customer_name", "invoice_number", "amount", "due_date"],
            additionalProperties: false,
          },
        },
      },
      required: ["invoices"],
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    title: "List invoices",
    description:
      "List invoices with computed days overdue, status and the next scheduled reminder. " +
      "status: unpaid (default), overdue, claimed (customer says they paid; awaiting confirmation), paid, or all.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["unpaid", "overdue", "claimed", "paid", "all"] },
        customer: { type: "string", description: "Filter by part of the customer name" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_invoice",
    title: "Invoice details and customer history",
    description:
      "Full detail for one invoice: customer contact, reminder plan, activity log, and the customer's payment history " +
      "(average days late on past invoices). Use this to judge the right tone before writing a follow-up plan.",
    inputSchema: { type: "object", properties: invoiceRef, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_followup_plan",
    title: "Create follow-up plan",
    description:
      "Save a reminder schedule for one unpaid invoice. PayNudge sends each reminder automatically on its date and stops " +
      "all remaining reminders as soon as the invoice is paid. Replaces any reminders still scheduled for this invoice. " +
      "Write each message yourself, matched to the customer's history (friendly for good payers, firmer for habitual late payers). " +
      "Do not paste a payment link: PayNudge appends the customer's invoice and payment link to every reminder automatically. " +
      "Dates must be today or later.",
    inputSchema: {
      type: "object",
      properties: {
        ...invoiceRef,
        priority: { type: "string", enum: ["low", "medium", "high"], description: "How urgently to chase this invoice" },
        strategy_note: { type: "string", description: "One or two sentences for the business owner explaining the approach" },
        reminders: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              send_on: date,
              channel: { type: "string", enum: ["email", "whatsapp"] },
              tone: { type: "string", enum: ["friendly", "firm", "final"] },
              subject: { type: "string", description: "Email subject (email only)" },
              message: { type: "string", description: "The reminder text, addressed to the customer's contact person" },
            },
            required: ["send_on", "channel", "tone", "message"],
            additionalProperties: false,
          },
        },
      },
      required: ["reminders"],
      additionalProperties: false,
    },
  },
  {
    name: "update_invoice",
    title: "Update invoice",
    description:
      "Change an invoice: mark it paid (this automatically stops its pending reminders), reopen it, or edit amount, due date, " +
      "notes, priority or the customer's contact details.",
    inputSchema: {
      type: "object",
      properties: {
        ...invoiceRef,
        status: { type: "string", enum: ["paid", "open"] },
        payment_ref: { type: "string", description: "UTR / UPI reference when marking paid" },
        amount: { type: "number" },
        due_date: date,
        notes: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        contact_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

async function resolveId(args: any): Promise<number> {
  if (args?.invoice_id) return Number(args.invoice_id);
  if (args?.invoice_number) return (await findInvoice({ invoice_number: String(args.invoice_number) })).id;
  throw new AppError("Give invoice_id or invoice_number.");
}

export async function callTool(name: string, args: any, baseUrl: string) {
  const appLink = (id: number) => `${baseUrl}/invoices/${id}`;
  switch (name) {
    case "get_collections_summary": {
      const s = await summary();
      return { ...s, dashboard: `${baseUrl}/` };
    }
    case "add_invoices": {
      const results = await addInvoices(args?.invoices || [], "claude");
      return {
        today: today(),
        results: results.map((r) => (r.invoice_id && r.result === "created" ? { ...r, open_in_paynudge: appLink(r.invoice_id) } : r)),
      };
    }
    case "list_invoices": {
      const rows = await listInvoices((args?.status as ListFilter) || "unpaid", args?.customer);
      return {
        today: today(),
        count: rows.length,
        invoices: rows.map((i) => ({
          invoice_id: i.id, invoice_number: i.invoice_number, customer: i.customer_name, amount: i.amount,
          due_date: i.due_date, status: i.status, days_overdue: i.status === "paid" ? null : i.days_overdue,
          priority: i.priority, reminders_scheduled: i.scheduled_count, reminders_sent: i.sent_count,
          next_reminder_on: i.next_reminder_on,
        })),
      };
    }
    case "get_invoice": {
      const id = await resolveId(args);
      const inv = await findInvoice({ invoice_id: id });
      const [reminders, activity, history] = await Promise.all([getReminders(id), getActivity(id, 15), customerHistory(inv.customer_id)]);
      return {
        today: today(),
        invoice: {
          invoice_id: inv.id, invoice_number: inv.invoice_number, amount: inv.amount, issue_date: inv.issue_date,
          due_date: inv.due_date, status: inv.status, days_overdue: inv.days_overdue, payment_ref: inv.payment_ref,
          priority: inv.priority, strategy_note: inv.strategy_note, notes: inv.notes,
        },
        customer: { name: inv.customer_name, contact_name: inv.contact_name, email: inv.email, phone: inv.phone },
        customer_payment_history: history,
        reminders: reminders.map((r) => ({ id: r.id, send_on: r.send_on, channel: r.channel, tone: r.tone, status: r.status, subject: r.subject, message: r.message, delivery: r.delivery })),
        activity: activity.map((a: any) => ({ at: a.created_at, by: a.actor, action: a.action, detail: a.detail })),
        customer_payment_page: payLink(baseUrl, inv.public_token),
        open_in_paynudge: appLink(inv.id),
      };
    }
    case "create_followup_plan": {
      const id = await resolveId(args);
      const res = await setFollowupPlan(id, { priority: args.priority, strategy_note: args.strategy_note, reminders: args.reminders || [] }, "claude");
      return { ...res, today: today(), open_in_paynudge: appLink(id) };
    }
    case "update_invoice": {
      const id = await resolveId(args);
      const { invoice_id, invoice_number, ...patch } = args || {};
      const inv = await updateInvoice(id, patch, "claude");
      return {
        invoice_id: inv.id, invoice_number: inv.invoice_number, status: inv.status, amount: inv.amount,
        due_date: inv.due_date, paid_on: inv.paid_on, open_in_paynudge: appLink(inv.id),
      };
    }
    default:
      throw new AppError(`Unknown tool: ${name}`);
  }
}
