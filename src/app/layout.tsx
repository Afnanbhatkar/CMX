import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CodeMind X — AI Software Engineering Platform",
  description:
    "CodeMind X V2: repository intelligence, controlled autonomous coding, and engineering answers. Phase 1 — premium design system, motion engine and shader engine.",
  keywords: ["CodeMind X", "AI engineering", "Next.js", "TypeScript", "design system"],
  authors: [{ name: "CodeMind X" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CodeMind X",
    description: "AI-powered software engineering platform",
    siteName: "CodeMind X",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
