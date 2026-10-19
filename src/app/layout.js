import "./globals.css";
import AppShell from '@/components/AppShell';

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Local transcription, subtitles, voiceover, and publishing.",
};

export default function RootLayout({ children }) {
  const workspace = <AppShell>{children}</AppShell>;
  return (
    <html lang="en">
      <body>{workspace}</body>
    </html>
  );
}
