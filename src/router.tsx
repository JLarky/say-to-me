import { createBrowserRouter, redirect } from "react-router";

import { notesLoader, sessionLoader } from "./loaders.ts";
import { RootErrorBoundary, RootLayout, SessionErrorBoundary } from "./layouts/RootLayout.tsx";
import { HomePage } from "./components/page/HomePage.tsx";
import { JarvisPage } from "./components/page/JarvisPage.tsx";
import { NewSearchPage } from "./components/page/NewSearchPage.tsx";
import { SessionsPage } from "./components/page/SessionsPage.tsx";
import { NewTimerPage } from "./components/page/NewTimerPage.tsx";
import { NewLandingPage } from "./components/page/NewLandingPage.tsx";
import { NewDashboardPage } from "./components/page/NewDashboardPage.tsx";
import { NewSettingsPage } from "./components/page/NewSettingsPage.tsx";
import { NoteSavePage } from "./components/page/NoteSavePage.tsx";
import { NotesPage } from "./components/page/NotesPage.tsx";
import { OrganizePage } from "./components/page/OrganizePage.tsx";
import { SessionGroupPage } from "./components/page/SessionGroupPage.tsx";
import { SessionPage } from "./components/page/SessionPage.tsx";
import { SessionTimersPage } from "./components/page/SessionTimersPage.tsx";

export function createAppRouter() {
  return createBrowserRouter([
    {
      Component: RootLayout,
      ErrorBoundary: RootErrorBoundary,
      HydrateFallback: () => null,
      children: [
        {
          path: "/",
          Component: HomePage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/search",
          Component: NewSearchPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/new",
          Component: NewLandingPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/dashboard",
          Component: NewDashboardPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/dashboard/:spaceId",
          Component: NewDashboardPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/settings",
          Component: NewSettingsPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/default",
          loader: () => redirect("/ses/default"),
        },
        {
          path: "/sessions",
          Component: SessionsPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/sessions/:pathKey",
          Component: SessionsPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/jarvis",
          Component: JarvisPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/organize",
          Component: OrganizePage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/organize/:folderId",
          Component: OrganizePage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/jarvis/timers/new",
          Component: NewTimerPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/project/:projectId",
          Component: SessionGroupPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/project/:projectId/workspace/:workspaceId",
          Component: SessionGroupPage,
          ErrorBoundary: RootErrorBoundary,
        },
        {
          path: "/ses/:sessionId",
          loader: sessionLoader,
          Component: SessionPage,
          ErrorBoundary: SessionErrorBoundary,
        },
        {
          path: "/ses/:sessionId/notes",
          loader: notesLoader,
          Component: NotesPage,
          ErrorBoundary: SessionErrorBoundary,
        },
        {
          path: "/ses/:sessionId/timers",
          loader: sessionLoader,
          Component: SessionTimersPage,
          ErrorBoundary: SessionErrorBoundary,
        },
        {
          path: "/ses/:sessionId/notes/:noteId",
          loader: sessionLoader,
          Component: NoteSavePage,
          ErrorBoundary: SessionErrorBoundary,
        },
      ],
    },
  ]);
}
