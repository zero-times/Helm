import "@fontsource-variable/manrope";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { HelmProvider } from "./state/helm-context";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <HelmProvider>
        <App />
      </HelmProvider>
    </BrowserRouter>
  </StrictMode>,
);

