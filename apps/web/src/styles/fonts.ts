import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

/**
 * SAKAR's three typefaces, downloaded at build time and served from this site (no third-party font
 * requests at runtime). Display: Instrument Serif; text: Geist; labels and numbers: Geist Mono.
 */
export const displayFont = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const sansFont = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const monoFont = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono",
  display: "swap",
});

/** Class names that define the three font variables on <html>. */
export const fontVariables = `${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`;
