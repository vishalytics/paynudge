"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkCredentials, endSession, requireUser, startSession } from "@/lib/auth";
import {
  AppError, addReminder, cancelReminder, customerClaimsPayment, runDueReminders, sendReminderNow, updateInvoice, updateReminder,
} from "@/lib/core";
import { resetDemoData } from "@/lib/db";
import { baseUrl } from "@/lib/base-url";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null ? undefined : String(v).trim();
};

function back(path: string, msg: string, err = false): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
}

async function guarded<T>(path: string, fn: () => Promise<T>, okMsg: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) back(path, e.message, true);
    throw e;
  }
  back(path, okMsg);
}

export async function login(fd: FormData) {
  if (!checkCredentials(s(fd, "email") || "", String(fd.get("password") || ""))) {
    redirect("/login?err=" + encodeURIComponent("Wrong email or password"));
  }
  await startSession();
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function saveInvoice(id: number, fd: FormData) {
  await requireUser();
  await guarded(`/invoices/${id}`, () =>
    updateInvoice(id, {
      amount: Number(s(fd, "amount")),
      due_date: s(fd, "due_date"),
      notes: s(fd, "notes") || null,
      priority: (s(fd, "priority") || null) as any,
      contact_name: s(fd, "contact_name"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
    }, "user"), "Changes saved");
}

export async function markPaid(id: number, fd: FormData) {
  await requireUser();
  await guarded(`/invoices/${id}`, () => updateInvoice(id, { status: "paid", payment_ref: s(fd, "payment_ref") }, "user"),
    "Marked as paid. Pending reminders were stopped.");
}

export async function reopenInvoice(id: number) {
  await requireUser();
  await guarded(`/invoices/${id}`, () => updateInvoice(id, { status: "open" }, "user"), "Invoice reopened");
}

export async function saveReminder(invoiceId: number, reminderId: number, fd: FormData) {
  await requireUser();
  await guarded(`/invoices/${invoiceId}`, () => updateReminder(reminderId, {
    send_on: s(fd, "send_on"), channel: s(fd, "channel") as any, tone: s(fd, "tone") as any,
    subject: s(fd, "subject") || "", message: s(fd, "message"),
  }, "user"), "Reminder updated");
}

export async function cancelReminderAction(invoiceId: number, reminderId: number) {
  await requireUser();
  await guarded(`/invoices/${invoiceId}`, () => cancelReminder(reminderId, "user"), "Reminder cancelled");
}

export async function sendNowAction(invoiceId: number, reminderId: number) {
  await requireUser();
  const base = await baseUrl();
  await guarded(`/invoices/${invoiceId}`, () => sendReminderNow(reminderId, base, "user"), "Reminder sent");
}

export async function addReminderAction(invoiceId: number, fd: FormData) {
  await requireUser();
  const message = s(fd, "message");
  if (!message) back(`/invoices/${invoiceId}`, "Write a message first", true);
  await guarded(`/invoices/${invoiceId}`, () => addReminder(invoiceId, {
    send_on: s(fd, "send_on") || "", channel: s(fd, "channel") as any, tone: s(fd, "tone") as any,
    subject: s(fd, "subject"), message: message!,
  }, "user"), "Reminder added");
}

export async function runRemindersAction() {
  await requireUser();
  const sent = await runDueReminders(await baseUrl(), "system");
  back("/", sent.length ? `Sent ${sent.length} reminder${sent.length > 1 ? "s" : ""} due today` : "Nothing due today. All caught up.");
}

export async function resetDemoAction() {
  await requireUser();
  await resetDemoData();
  back("/", "Demo data reset");
}

export async function claimPaymentAction(token: string, fd: FormData) {
  await customerClaimsPayment(token, s(fd, "reference") || "");
  revalidatePath("/", "layout");
  redirect(`/pay/${token}?done=1`);
}
