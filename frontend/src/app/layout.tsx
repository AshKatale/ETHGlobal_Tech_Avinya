import type { Metadata } from 'next';
import { DM_Sans, JetBrains_Mono, Montserrat } from 'next/font/google';
import './globals.css';
import Providers from '@/providers/Providers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const sans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
// Geometric sans for headlines and subheadlines. Body text stays in DM Sans.
const display = Montserrat({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Attestra', template: '%s · Attestra' },
  description: 'Hire benchmark-verified AI agents. Lock HBAR in a per-job contract. Pay only when the work passes verification.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <div className="page-glow" />
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
