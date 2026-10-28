import "./globals.css";
import AppShell from '@/components/AppShell';

export const metadata = {
  title: "Studio Suite - Automated Video Pipeline",
  description: "Source automation, video creation through Video Editor MCP, and publishing.",
};

export default function RootLayout({ children }) {
  const workspace = <AppShell>{children}</AppShell>;
  return (
    <html lang="en">
      <body>{workspace}</body>
    </html>
  );
}
