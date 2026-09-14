import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Paper Agent — AI 学术阅读器',
  description: '划选英文论文内容，即时获得上下文感知的中文翻译与解释。',
  manifest: '/manifest.webmanifest',
  applicationName: 'Paper Agent',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Paper Agent' },
  openGraph: {
    title: 'Paper Agent — AI 学术阅读器',
    description: '划选论文，即时理解。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Paper Agent 双栏论文阅读器' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Paper Agent — AI 学术阅读器',
    description: '划选论文，即时理解。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><meta content="#3157d5" name="theme-color" /></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
