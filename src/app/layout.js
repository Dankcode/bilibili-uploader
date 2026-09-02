import "./globals.css";
import AppShell from '@/components/AppShell';

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Local transcription, subtitles, voiceover, and publishing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
