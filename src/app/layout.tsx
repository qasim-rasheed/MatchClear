import type { Metadata } from "next";
import "./globals.css";
import "@/components/pipeline.css";
export const metadata: Metadata = {
  title: "MatchClear — Tournament workspace",
  description: "Plan team shirts and review opposing combinations before you order.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
