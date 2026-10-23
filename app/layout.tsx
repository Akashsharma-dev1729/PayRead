import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'PayRead — Read what matters', description: 'Pay once per article. Good writing, without another subscription.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
    </head>
    <body>{children}</body>
  </html>;
}
