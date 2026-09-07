import { Redirect, Route, Switch, useLocation } from "wouter";
import { useSession } from "./lib/session";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { ResetPage } from "./pages/ResetPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { BoardPage } from "./pages/BoardPage";
import { Header } from "./components/Header";

export function AppRoutes() {
  const session = useSession();
  const [, navigate] = useLocation();

  if (session.loading) return <main className="p-6 text-sm">Loading…</main>;

  const signedIn = session.me !== null && !session.setupRequired;

  // Token routes work signed in or out, so they come before the sign-in wall.
  return (
    <>
      {signedIn && <Header onSignedOut={session.refresh} />}
      <Switch>
        <Route path="/invite/:token">
          {(params) => <InviteAcceptPage token={params.token!} onJoined={(id) => navigate(`/projects/${id}/board`)} />}
        </Route>
        <Route path="/reset/:token">{(params) => <ResetPage token={params.token!} />}</Route>
        {session.setupRequired ? (
          <Route>
            <SetupPage onReady={session.refresh} />
          </Route>
        ) : session.me ? (
          <>
            <Route path="/projects/:id/board">{(params) => <BoardPage projectId={params.id!} />}</Route>
            <Route path="/">{() => <ProjectsPage onOpen={(id) => navigate(`/projects/${id}/board`)} />}</Route>
            {/* Any other URL for a signed-in user (e.g. /login or /setup, reached via back/forward
                or a stale link like the post-reset "/login?reset=1") must not fall through to
                `Switch` rendering nothing — send them to the shell instead, so the URL bar stays
                honest about what's actually on screen. */}
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
    </>
  );
}
