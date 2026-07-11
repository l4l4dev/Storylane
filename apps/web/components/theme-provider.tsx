"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Class-based theming for shadcn tokens. `defaultTheme="system"` +
// `enableSystem` follows the OS's light/dark preference automatically,
// while also allowing an explicit user toggle later via the app shell.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
