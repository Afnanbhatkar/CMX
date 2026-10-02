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
    "CodeMind X is an AI software engineering platform: repository intelligence, hybrid code search, architecture awareness, security and testing intelligence, and verified AI coding — every change reviewed before it lands.",
  keywords: [
    "CodeMind X",
    "AI software engineering",
    "repository intelligence",
    "code search",
    "AI coding",
    "developer tools",
  ],
  authors: [{ name: "CodeMind X" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CodeMind X — AI Software Engineering Platform",
    description:
      "Understand your codebase. Search it. Analyze it. Build with AI. Verify every change before it ships.",
    siteName: "CodeMind X",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CodeMind X — AI Software Engineering Platform",
    description:
      "Repository intelligence, hybrid search, architecture awareness and verified AI coding in one workspace.",
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
