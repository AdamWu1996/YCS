import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: '輕鬆要錢',
  description: '公司內部中介層與工具平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
