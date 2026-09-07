import { SessionProvider } from "./lib/session";
import { AppRoutes } from "./app-routes";

export function App() {
  return (
    <SessionProvider>
      <AppRoutes />
    </SessionProvider>
  );
}
