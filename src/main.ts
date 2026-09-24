import "./style.css";
import { App } from "./ui/screens";

const mount = document.querySelector<HTMLDivElement>("#app")!;
const app = new App(mount);

if (import.meta.env.DEV) {
  (window as unknown as { __debugApp: unknown }).__debugApp = app;
}
