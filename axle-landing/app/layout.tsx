import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GrainOverlay } from "@/components/fx/grain-overlay";
import { SmoothScroll } from "@/components/site/smooth-scroll";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";

const display = Inter({
  subsets: ["latin"],
  variable: "--font-display-src",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Rivet — Build your way", template: "%s | Rivet" },
  description:
    "Everything you need to build, with the freedom to build your way. Rivet connects your code, models, and tools in one thoughtful workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable + " " + mono.variable}>
      <body id="top" className="bg-ink text-paper antialiased">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <SmoothScroll>
          <Navbar />
          <main id="main-content" tabIndex={-1}>{children}</main>
          <Footer />
        </SmoothScroll>
        <GrainOverlay />
      </body>
    </html>
  );
}
