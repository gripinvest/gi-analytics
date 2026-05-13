import "./globals.css";

// metadataBase keeps openGraph image URLs absolute on every deploy URL.
// Templated titles give per-page pages (like /projects/[id]) a "<page> · Grip
// Analytics" tab title without each page having to remember the suffix.
export const metadata = {
  metadataBase: new URL("https://grip-analytics.vercel.app"),
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
