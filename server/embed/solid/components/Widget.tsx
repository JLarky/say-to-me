/** @jsxImportSource solid-js */
import { IdButton } from "./IdButton.tsx";
import { ParkButton } from "./ParkButton.tsx";

export function Widget(props: { sessionId: string | null; el: HTMLElement }) {
  return (
    <>
      <IdButton sessionId={props.sessionId} />
      <ParkButton sessionId={props.sessionId} el={props.el} />
    </>
  );
}
