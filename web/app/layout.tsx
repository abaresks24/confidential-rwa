import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Sagittaire",
  description:
    "Your tokenized treasury keeps earning, and no one can read how much you hold.",
  applicationName: "Sagittaire",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/mark-ink-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/mark-ink-48.png", type: "image/png", sizes: "48x48" },
      { url: "/brand/mark-ink-256.png", type: "image/png", sizes: "256x256" },
    ],
    apple: [{ url: "/brand/mark-ink-180.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Sagittaire",
    description:
      "Your tokenized treasury keeps earning, and no one can read how much you hold.",
    siteName: "Sagittaire",
    images: [{ url: "/brand/mark-ink-256.png", width: 256, height: 256, alt: "Sagittaire" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Sagittaire",
    description: "Your tokenized treasury keeps earning, and no one can read how much you hold.",
    images: ["/brand/mark-ink-256.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="theme-color" content="#D6212A" />
      </head>
      <body>{children}</body>
    </html>
  );
}
