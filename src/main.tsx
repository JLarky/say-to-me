import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./styles.css";

import { createAppRouter } from "./router.tsx";
import { initBrowserTracing } from "./tracing.ts";

if (!import.meta.env?.VITEST) {
  void initBrowserTracing();
  const router = createAppRouter();
  const container = document.getElementById("root")!;
  // On Vite HMR re-execution, reuse the existing root instead of calling
  // createRoot() again on the same container (which triggers a React warning
  // and breaks router navigation).
  const hotData = import.meta.hot?.data as { root?: ReturnType<typeof createRoot> } | undefined;
  const root = hotData?.root ?? createRoot(container);
  if (hotData) hotData.root = root;
  root.render(<RouterProvider router={router} />);
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
