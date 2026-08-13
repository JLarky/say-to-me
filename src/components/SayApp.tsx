import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { createAppRouter } from "../router.tsx";
import { initBrowserTracing } from "../tracing.ts";
import "../styles.css";

export default function SayApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void initBrowserTracing();
    const container = containerRef.current;
    if (!container) return;

    const router = createAppRouter();
    const root = createRoot(container);
    root.render(<RouterProvider router={router} />);
    return () => root.unmount();
  }, []);

  return <div ref={containerRef} id="root" />;
}
