import "./globals.css";
import AppShell from '@/components/AppShell';
import OperatorSession from '@/components/OperatorSession';
import { authRequired } from '@/lib/agent/auth.js';

// Decide from the running server's mode, not the mode used for next build.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Local transcription, subtitles, voiceover, and publishing.",
};

export default function RootLayout({ children }) {
  const workspace = <AppShell>{children}</AppShell>;
  return (
    <html lang="en">
      <body>{authRequired() ? <OperatorSession>{workspace}</OperatorSession> : workspace}</body>
    </html>
  );
}
