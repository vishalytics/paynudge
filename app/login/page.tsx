import { login } from "../actions";
import { DEMO_EMAIL } from "@/lib/auth";
import { Submit } from "../client";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <div className="center-wrap">
      <div className="auth">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 18, fontSize: 20 }}>
          <span className="brand-mark">₹</span> PayNudge
        </div>
        <div className="card card-body">
          <h1 style={{ fontSize: 19 }}>Log in</h1>
          <p className="muted" style={{ margin: "4px 0 16px" }}>Claude writes the follow-ups. PayNudge chases the money.</p>
          {err && <div className="flash err">{err}</div>}
          <form action={login}>
            <label className="f"><span>Email</span>
              <input className="in" name="email" type="email" defaultValue={DEMO_EMAIL} required />
            </label>
            <label className="f"><span>Password</span>
              <input className="in" name="password" type="password" required autoFocus />
            </label>
            <Submit className="btn primary" pending="Logging in…">Log in</Submit>
          </form>
        </div>
        <p className="foot">Demo workspace for the Volopay assignment. Test login is in the submission notes.</p>
      </div>
    </div>
  );
}
