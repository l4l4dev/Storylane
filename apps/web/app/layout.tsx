import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { NotificationListener } from "@/components/features/shell/notification-listener";
import { Toaster } from "@/components/ui/toast";
import { PALETTES } from "@/lib/theme-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Storylane",
  description: "Agile project management with backlog, iterations, and velocity tracking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* TASK-235: three dark palettes (Ember/Slate/Moss) plus light, and System
            (OS auto light/dark — the default). `themes` only lists the explicit
            palettes; next-themes appends "system" to the list itself when
            enableSystem is set — see components/features/shell/mode-toggle.tsx. */}
        <NextThemesProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          themes={PALETTES.map((p) => p.value)}
          disableTransitionOnChange
        >
          <NotificationListener />
          {children}
          <Toaster />
        </NextThemesProvider>
        <Analytics />
      </body>
    </html>
  );
}
