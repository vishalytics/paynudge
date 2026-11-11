import { randomBytes } from "crypto";
import { addDays, today } from "./dates";

type Q = (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export function newToken(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Demo workspace: "Kaveri Packaging" — a small B2B packaging supplier with money stuck in
 * unpaid invoices. Dates are relative to today so the demo always looks current.
 */
export async function seedDemoData(q: Q) {
  const t = today();
  const d = (n: number) => addDays(t, n);

  const customers = [
    ["Urban Brew Cafés", "Anita Rao", "accounts@urbanbrew.example", "+91 98100 22011"],
    ["Sharma Traders", "Rakesh Sharma", "rakesh@sharmatraders.example", "+91 98712 44190"],
    ["GreenLeaf Organics", "Meera Iyer", "finance@greenleaf.example", "+91 99582 31007"],
    ["Nimbus D2C", "Arjun Mehta", "ap@nimbusd2c.example", "+91 97111 80456"],
    ["FitFuel Nutrition", "Karan Gill", "karan@fitfuel.example", "+91 98990 13562"],
    ["Coastal Gifts Co", "Farah Khan", "farah@coastalgifts.example", "+91 90040 77213"],
  ];
  const ids: Record<string, number> = {};
  for (const [name, contact, email, phone] of customers) {
    const [r] = await q(
      "insert into customers (name, contact_name, email, phone) values ($1,$2,$3,$4) returning id",
      [name, contact, email, phone]
    );
    ids[name] = r.id;
  }

  type Inv = {
    c: string; no: string; amt: number; issue: string; due: string;
    status?: "open" | "claimed" | "paid"; paid_on?: string; ref?: string;
    priority?: string; note?: string; by?: string;
  };
  const invoices: Inv[] = [
    // Payment history (helps Claude judge each customer)
    { c: "Sharma Traders", no: "INV-1952", amt: 98000, issue: d(-150), due: d(-120), status: "paid", paid_on: d(-82) },
    { c: "Sharma Traders", no: "INV-1987", amt: 121500, issue: d(-110), due: d(-80), status: "paid", paid_on: d(-39) },
    { c: "GreenLeaf Organics", no: "INV-1990", amt: 41200, issue: d(-95), due: d(-65), status: "paid", paid_on: d(-66) },
    { c: "Urban Brew Cafés", no: "INV-1995", amt: 72000, issue: d(-90), due: d(-60), status: "paid", paid_on: d(-48) },
    // Current receivables
    { c: "Coastal Gifts Co", no: "INV-2035", amt: 27300, issue: d(-100), due: d(-70), status: "paid", paid_on: d(-3), ref: "UPI 6620 1184 0931" },
    { c: "FitFuel Nutrition", no: "INV-2039", amt: 64800, issue: d(-51), due: d(-21), status: "claimed", ref: "UTR 4471 2290 1183" },
    { c: "Sharma Traders", no: "INV-2038", amt: 142000, issue: d(-82), due: d(-52) },
    {
      c: "Urban Brew Cafés", no: "INV-2041", amt: 86400, issue: d(-64), due: d(-34), priority: "medium",
      note: "Usually pays ~12 days late but always pays. Keep it warm: a friendly nudge, then a firmer note with the payment link.",
    },
    { c: "GreenLeaf Organics", no: "INV-2044", amt: 38500, issue: d(-39), due: d(-9) },
    { c: "Nimbus D2C", no: "INV-2046", amt: 215000, issue: d(-24), due: d(6) },
  ];

  const invIds: Record<string, number> = {};
  for (const i of invoices) {
    const [r] = await q(
      `insert into invoices (customer_id, invoice_number, amount, issue_date, due_date, status, paid_on, payment_ref,
         priority, strategy_note, public_token, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [ids[i.c], i.no, i.amt, i.issue, i.due, i.status || "open", i.paid_on || null, i.ref || null,
        i.priority || null, i.note || null, newToken(), i.by || "user"]
    );
    invIds[i.no] = r.id;
    await q("insert into activity (invoice_id, actor, action, detail, created_at) values ($1,'system','Invoice imported',$2, now() - interval '6 days')", [
      r.id, `${i.no} for ${i.c}`,
    ]);
  }

  // A reminder plan Claude created earlier for Urban Brew (one already sent).
  const ub = invIds["INV-2041"];
  await q(
    `insert into reminders (invoice_id, send_on, channel, tone, subject, message, status, delivery, sent_at, created_by)
     values ($1,$2,'email','friendly',$3,$4,'sent','email (simulated)', now() - interval '3 days','claude')`,
    [ub, d(-3), "Quick reminder: invoice INV-2041 (₹86,400)",
      "Hi Anita,\n\nHope the new outlet launch went well! A quick reminder that invoice INV-2041 for ₹86,400 was due on " +
      d(-34) + ". You can view it and pay in one click using the link below.\n\nThanks,\nKaveri Packaging"]
  );
  await q(
    `insert into reminders (invoice_id, send_on, channel, tone, subject, message, created_by)
     values ($1,$2,'whatsapp','firm',null,$3,'claude')`,
    [ub, d(2), "Hi Anita, following up on INV-2041 (₹86,400), now over a month overdue. Could you confirm a payment date this week? Invoice and payment details: see link."]
  );
  await q("insert into activity (invoice_id, actor, action, detail, created_at) values ($1,'claude','Follow-up plan created','2 reminders: friendly email, then firm WhatsApp', now() - interval '4 days')", [ub]);
  await q("insert into activity (invoice_id, actor, action, detail, created_at) values ($1,'system','Reminder sent','Friendly email (simulated)', now() - interval '3 days')", [ub]);

  await q("insert into activity (invoice_id, actor, action, detail, created_at) values ($1,'customer','Customer reported payment','UTR 4471 2290 1183', now() - interval '1 day')", [invIds["INV-2039"]]);
  await q("insert into activity (invoice_id, actor, action, detail, created_at) values ($1,'user','Marked as paid','UPI 6620 1184 0931', now() - interval '3 days')", [invIds["INV-2035"]]);
}
