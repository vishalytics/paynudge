import { notFound } from "next/navigation";
import { BUSINESS_NAME, PAYMENT_UPI, getInvoiceByToken } from "@/lib/core";
import { fmtDate, inr } from "@/lib/dates";
import { claimPaymentAction } from "../../actions";
import { CopyButton, Submit } from "../../client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

/** Public page the customer opens from a reminder. No login, no Claude needed. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const inv = await getInvoiceByToken(token);
  if (!inv) notFound();

  return (
    <div className="center-wrap">
      <div className="pay">
        <div className="card card-body">
          <div className="muted small">Invoice from</div>
          <h1 style={{ fontSize: 20 }}>{BUSINESS_NAME}</h1>
          <div className="muted" style={{ marginTop: 2 }}>To {inv.customer_name}{inv.contact_name ? ` · ${inv.contact_name}` : ""}</div>

          <div style={{ marginTop: 18 }} className="muted small">{inv.invoice_number} · due {fmtDate(inv.due_date)}</div>
          <div className="pay-amount num">{inr(inv.amount)}</div>

          {inv.status === "paid" ? (
            <div className="flash" style={{ marginTop: 12 }}>Paid on {fmtDate(inv.paid_on)}. Thank you!</div>
          ) : inv.status === "claimed" || done ? (
            <div className="flash" style={{ marginTop: 12 }}>
              Thanks! We&apos;ve told {BUSINESS_NAME} you&apos;ve paid{inv.payment_ref ? ` (ref ${inv.payment_ref})` : ""}. Reminders are paused while they confirm.
            </div>
          ) : (
            <>
              {inv.days_overdue > 0 && <span className="pill overdue">{inv.days_overdue} days overdue</span>}
              <div className="paybox">
                <div className="small muted" style={{ marginBottom: 6 }}>Pay by UPI or bank transfer</div>
                <div className="copyrow">
                  <code className="code">{PAYMENT_UPI}</code>
                  <CopyButton text={PAYMENT_UPI} label="Copy UPI ID" />
                </div>
                <div className="small muted" style={{ marginTop: 8 }}>
                  A/c 50200012345678 · IFSC HDFC0001234 · {BUSINESS_NAME} <i>(demo details)</i>
                </div>
              </div>
              <form action={claimPaymentAction.bind(null, token)}>
                <label className="f"><span>Already paid? Add your UTR / UPI reference</span>
                  <input className="in" name="reference" placeholder="e.g. UTR 4471 2290 1183" />
                </label>
                <Submit className="btn primary" pending="Sending…">I&apos;ve made the payment</Submit>
              </form>
            </>
          )}
        </div>
        <p className="foot">Sent with PayNudge on behalf of {BUSINESS_NAME}. Payment collection is simulated in this demo.</p>
      </div>
    </div>
  );
}
