import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

/**
 * Registro central dos plugins GSAP usados no app — importado uma vez (ver
 * main.tsx) antes de qualquer componente rodar. `useGSAP` (hook de limpeza
 * automatica em React), `ScrollTrigger` (reveal do Dashboard, ver
 * DashboardPage.tsx) e `DrawSVGPlugin` (traço do glifo de marca, ver
 * BrandMark.tsx) sao os unicos plugins que o projeto usa.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger, DrawSVGPlugin);

export { gsap, useGSAP, ScrollTrigger, DrawSVGPlugin };
