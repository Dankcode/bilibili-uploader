import "./globals.css";

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Local transcription, subtitles, voiceover, and publishing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
