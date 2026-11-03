import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Latin subset only: every woff2 in dist is precached by the service worker.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import App from "./App";

// No browser right-click menu: Claudex shows its own menus. Text fields keep the native
// one, so copy and paste still work there.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest?.("input, textarea, [contenteditable='true']")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
