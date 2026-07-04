"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Class-based theming for shadcn tokens. `defaultTheme="system"` +
// `enableSystem` preserves the app's original automatic light/dark behavior
// (previously `@media (prefers-color-scheme: dark)`) while also allowing an
// explicit user toggle later via the app shell.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
