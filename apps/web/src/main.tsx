import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/newsreader";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";

import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
