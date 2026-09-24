import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Darka's Studio", template: "%s · Darka's Studio" },
  description: "Make songs with your friends.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e0a15" },
    { media: "(prefers-color-scheme: light)", color: "#fbf6f2" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const light = (await cookies()).get("theme")?.value === "light";

  return (
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${light ? "light" : ""} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col overflow-x-hidden bg-bg text-fg">
        {/* Soft brand glow behind everything. */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[520px] overflow-hidden">
          <div className="absolute -left-40 -top-48 h-[480px] w-[480px] animate-float rounded-full bg-pink/20 blur-[110px] light:bg-pink/12" />
          <div className="absolute -right-32 -top-40 h-[420px] w-[420px] animate-float rounded-full bg-violet/20 blur-[110px] [animation-delay:-7s] light:bg-violet/12" />
          <div className="absolute left-1/3 -top-64 h-[360px] w-[360px] rounded-full bg-peach/10 blur-[120px]" />
        </div>
        {children}
      </body>
    </html>
  );
}
