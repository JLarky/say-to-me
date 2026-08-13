/** Vite/Astro HMR entry for `<say-to-me-widget>`. */
import { registerWidget } from "./widget-register.tsx";

registerWidget();

if (import.meta.hot) {
  import.meta.hot.accept();
}
