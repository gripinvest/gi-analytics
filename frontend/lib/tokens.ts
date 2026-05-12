// Typed token references for non-CSS contexts (Recharts, canvas, inline SVG).
// Mirrors grip-code/design-tokens.tokens.json. For DOM styling use Tailwind
// aliases / the --gi-* CSS vars instead of importing from here.

export const color = {
  navy:    { 50:"#e7f1fe",100:"#c8defa",200:"#94bbf2",300:"#6096e3",400:"#2b6bd4",500:"#1552b0",600:"#2b5895",700:"#00357c",800:"#002456",900:"#001533" },
  teal:    { 50:"#e5f8f8",100:"#ccf1f1",200:"#99e3e3",300:"#4dd4d3",400:"#00cccb",500:"#00b8b7",600:"#00a3a2",700:"#008584",800:"#005c5c",900:"#003838" },
  success: { 50:"#e6f7f0",100:"#c2ecd9",200:"#8cddb8",300:"#52cc95",400:"#28b87a",500:"#12a46e",600:"#0a8b65",700:"#076e4f",800:"#05523b",900:"#033627" },
  error:   { 50:"#fdecec",100:"#fbd5d5",200:"#f7abab",300:"#f38080",400:"#f15b5b",500:"#ef3c3c",600:"#d42b2b",700:"#b02020",800:"#871919",900:"#5e1212" },
  warning: { 50:"#fff5e0",100:"#ffecc4",200:"#ffd88a",300:"#ffc554",400:"#ffbe3e",500:"#ffb629",600:"#e59e14",700:"#c0840f",800:"#966709",900:"#6b4a06" },
  neutral: { 0:"#ffffff",50:"#fcfcfc",100:"#f7f7fc",200:"#ecedef",300:"#e6e6e6",400:"#d9d9d9",500:"#a1a3ad",550:"#767880",600:"#696b74",700:"#555770",800:"#373a46",900:"#282c3f" },
} as const;

export const semantic = {
  textHeading: color.neutral[900],
  textBody: color.neutral[700],
  textSecondary: color.neutral[600],
  textTertiary: color.neutral[550],
  borderDefault: color.neutral[300],
  borderMuted: color.neutral[200],
  surface: color.neutral[0],
  page: color.neutral[50],
  actionPrimary: color.navy[700],
  actionAccent: color.teal[500],
} as const;

/** Ordered series colors for multi-series charts. Restrained: navy then teal lead. */
export const chartPalette = [
  color.navy[500],
  color.teal[500],
  color.navy[300],
  color.warning[500],
  color.success[500],
  color.navy[700],
  color.teal[700],
] as const;

/** Magnitude ramp for "bad-ness" metrics like zero-result rate (0..100). */
export function zrrColor(pct: number): string {
  if (pct == null || Number.isNaN(pct)) return color.neutral[400];
  if (pct < 10) return color.success[500];
  if (pct < 25) return color.success[400];
  if (pct < 40) return color.warning[400];
  if (pct < 55) return color.warning[600];
  if (pct < 70) return color.error[400];
  return color.error[600];
}

/** Tints used behind the ramp colors (table cells, chips). */
export function zrrBg(pct: number): string {
  if (pct == null || Number.isNaN(pct)) return color.neutral[100];
  if (pct < 25) return color.success[50];
  if (pct < 55) return color.warning[50];
  return color.error[50];
}
