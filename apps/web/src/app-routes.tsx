import { Redirect, Route, Switch, useLocation } from "wouter";
import { useSession } from "./lib/session";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { ResetPage } from "./pages/ResetPage";

export function AppRoutes() {
  const session = useSession();
  const [, navigate] = useLocation();

  if (session.loading) return <main className="p-6 text-sm">Loading…</main>;

  // Token routes work signed in or out, so they come before the sign-in wall.
  return (
    <Switch>
      <Route path="/invite/:token">
        {(params) => <InviteAcceptPage token={params.token!} onJoined={(id) => navigate(`/projects/${id}`)} />}
      </Route>
      <Route path="/reset/:token">{(params) => <ResetPage token={params.token!} />}</Route>
      {session.setupRequired ? (
        <Route>
          <SetupPage onReady={session.refresh} />
        </Route>
      ) : session.me ? (
        // Signed-in routes: the real project list and board arrive in Task 9b.
        <>
          <Route path="/projects/:id">
            {(params) => <main className="p-6 text-sm">Signed in as {session.me!.displayName}. Project {params.id}.</main>}
          </Route>
          <Route path="/">
            <main className="p-6 text-sm">Signed in as {session.me.displayName}.</main>
          </Route>
          {/* Any other URL for a signed-in user (e.g. /login or /setup, reached via back/forward
              or a stale link like the post-reset "/login?reset=1") must not fall through to
              `Switch` rendering nothing — send them to the shell instead. */}
          <Route>
            <Redirect to="/" />
          </Route>
        </>
      ) : (
        <Route>
          <LoginPage onSignedIn={session.refresh} />
        </Route>
      )}
    </Switch>
  );
}
