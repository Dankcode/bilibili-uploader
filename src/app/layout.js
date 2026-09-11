import "./globals.css";
import AppShell from '@/components/AppShell';
import OperatorSession from '@/components/OperatorSession';

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Local transcription, subtitles, voiceover, and publishing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><OperatorSession><AppShell>{children}</AppShell></OperatorSession></body>
    </html>
  );
}
