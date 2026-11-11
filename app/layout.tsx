import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PayNudge — get paid on time",
  description: "Claude writes the follow-ups. PayNudge chases the money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
