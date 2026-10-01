import './globals.css';
import type { ReactNode } from 'react';
export const metadata={title:'PayRead — Read what matters',description:'Simple pay-per-article reading platform'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
