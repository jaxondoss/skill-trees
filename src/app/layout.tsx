import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";
import { OfflineSync } from "@/components/pwa/OfflineSync";
import { Dock } from "@/components/shell/Dock";
import { Field } from "@/components/shell/Field";
import { JournalDialog } from "@/components/shell/JournalDialog";
import { PointerLight } from "@/components/shell/PointerLight";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const mono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b13",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Field />
        <PointerLight />
        <div className="mx-auto flex min-h-dvh w-full max-w-[1480px] flex-col px-4 pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6">
          {children}
        </div>
        <Suspense fallback={null}>
          <Dock />
        </Suspense>
        <JournalDialog />
        <OfflineSync />
      </body>
    </html>
  );
}
