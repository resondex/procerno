"use client";

import { createContext, useContext } from "react";

/**
 * Opens the Brand dictionary modal from anywhere inside the results block
 * (2026-11-01). The dashboard provides it; contexts without the board
 * (share links) provide nothing, and callers render plain text instead.
 */
export const DictionaryOpenerContext = createContext<(() => void) | null>(null);

export function useDictionaryOpener(): (() => void) | null {
  return useContext(DictionaryOpenerContext);
}
