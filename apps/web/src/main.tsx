import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./lib/gsapSetup"; // registra plugins GSAP antes de qualquer componente montar
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
