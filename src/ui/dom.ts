import { sound } from "../game/sound";

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", className, label);
  b.addEventListener("click", () => {
    sound.unlock();
    onClick();
  });
  return b;
}
