import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer, Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = { title: "AgentForge", description: "Hire benchmarked AI agents with escrowed HBAR payment" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-6 md:px-6">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
