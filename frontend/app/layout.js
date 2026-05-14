import "./globals.css";
import "./editorial.css";
import Script from "next/script";
import { DesignProvider } from "@/lib/design";

// First-paint flash fix. Stamps data-design on <html> before React hydrates,
// so the editorial token set applies on the very first paint instead of
// flashing classic chrome and then swapping.
//
// Editorial is the product default — only an EXPLICIT 'classic' saved in
// localStorage opts back. Any other state (missing key, garbage value, a
// thrown localStorage from private-mode) falls through to editorial.
//
// Stored as a constant separate from the JSX so it stays trivially auditable
// — no template interpolation, no user input, no concatenation.
const designBootstrap =
  "(function(){try{var d=localStorage.getItem('grip-design');" +
  "if(d!=='classic'){d='editorial';}" +
  "document.documentElement.setAttribute('data-design',d);" +
  "}catch(e){document.documentElement.setAttribute('data-design','editorial');}})();";

// metadataBase keeps openGraph image URLs absolute on every deploy URL.
// Templated titles give per-page pages (like /projects/[id]) a "<page> · Grip
// Analytics" tab title without each page having to remember the suffix.
export const metadata = {
  metadataBase: new URL("https://grip-analytics-psi.vercel.app"),
  title: {
    default: "Grip Analytics",
    template: "%s · Grip Analytics",
  },
  description:
    "Internal analytics platform — DuckDB-backed dashboards + Claude Q&A over weekly product event exports.",
  applicationName: "Grip Analytics",
  keywords: ["grip", "analytics", "dashboard", "duckdb", "asset search"],
  authors: [{ name: "Grip Invest" }],
  openGraph: {
    title: "Grip Analytics",
    description: "Internal analytics platform — DuckDB + Claude over product event exports.",
    siteName: "Grip Analytics",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Grip Analytics",
    description: "Internal analytics platform — DuckDB + Claude.",
  },
  robots: { index: false, follow: false }, // private internal tool
};

// themeColor controls the iOS/Android browser-chrome tint when the app is added
// to home-screen, and the address-bar color on Chrome Android. Matches the
// navy surface from the in-app palette.
export const viewport = {
  themeColor: "#0F2F4D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter + IBM Plex Mono (Classic) + Fraunces + Newsreader (Editorial).
            Variable axes requested for Fraunces (opsz/SOFT/WONK) and Newsreader
            (opsz roman + italic). One request keeps the network cost low. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,400..800,0..100,0..1;1,9..144,400..800,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&display=swap"
          rel="stylesheet"
        />
        <Script id="design-bootstrap" strategy="beforeInteractive">
          {designBootstrap}
        </Script>
      </head>
      <body>
        <DesignProvider>{children}</DesignProvider>
      </body>
    </html>
  );
}
