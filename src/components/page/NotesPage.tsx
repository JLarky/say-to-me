import React from "react";
import { useLoaderData, useParams } from "react-router";

import { NotesPageContent } from "../NotesPages.tsx";
import { notesLoader } from "../../loaders.ts";

export function NotesPage() {
  const { sessionId } = useParams();
  const { initialSession, initialNotes } = useLoaderData<typeof notesLoader>();
  return (
    <NotesPageContent
      initialNotes={initialNotes}
      initialSession={initialSession}
      sessionId={sessionId}
    />
  );
}
