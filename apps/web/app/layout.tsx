import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { KAN_ACCENT_INLINE_SCRIPT } from "@/lib/kan/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KAN — Asistente Inteligente",
  description: "KAN: un compañero inteligente para tu mundo digital y físico.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Sin flash del acento default al recargar con una preferencia guardada — ver lib/kan/theme.ts. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: KAN_ACCENT_INLINE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-surface text-ink">{children}</body>
    </html>
  );
}
