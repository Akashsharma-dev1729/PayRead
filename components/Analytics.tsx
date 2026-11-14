'use client';
import Script from 'next/script';
import { useEffect } from 'react';
import { track } from '@/lib/analytics/tracker';

/**
 * Site-wide tracking, mounted once in the root layout:
 * - Vercel Web Analytics (visitors, pages, referrers, countries, devices),
 *   cookie-free. Its script is served by Vercel once Analytics is enabled for
 *   the project; elsewhere (local, CI) it simply 404s and nothing happens.
 * - PayRead's own anonymous funnel log: one page_view per page load.
 */
export default function Analytics() {
  useEffect(() => { track('page_view'); }, []);
  return <>
    <Script id="vercel-analytics-queue" strategy="afterInteractive">
      {'window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };'}
    </Script>
    <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
  </>;
}
