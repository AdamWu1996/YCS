import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'YCS - 請款裁決系統',
  description: 'YCS 請款裁決管理系統',
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
