import clsx, { type ClassValue } from "clsx";

/** Conditional className join. `cn("a", cond && "b", { c: cond })`. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
