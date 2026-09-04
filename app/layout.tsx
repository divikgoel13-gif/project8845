import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNI8 — Campus Food, Scheduled Pickup",
  description: "Your class ends. Your food is ready.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
