import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "crypto";

export const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@paynudge.app";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "volopay2026";
const COOKIE = "pn_session";

function sessionValue() {
  return createHash("sha256").update(`${DEMO_EMAIL}:${DEMO_PASSWORD}:paynudge`).digest("hex");
}

export function checkCredentials(email: string, password: string) {
  return email.trim().toLowerCase() === DEMO_EMAIL.toLowerCase() && password === DEMO_PASSWORD;
}

export async function startSession() {
  (await cookies()).set(COOKIE, sessionValue(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function requireUser() {
  const v = (await cookies()).get(COOKIE)?.value;
  if (v !== sessionValue()) redirect("/login");
}
