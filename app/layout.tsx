import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const siteUrl = "https://spine-nine-orpin.vercel.app";
const description =
  "Know what your store really earns. Spine brings Shopify sales, ad spend, product costs and profit into one clear view, so you can grow with confidence.";
const socialImage = "/opengraph-image.png?v=2026-10-05";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Spine — The backbone of your business",
  description,
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Spine",
    title: "Spine — The backbone of your business",
    description,
    images: [{ url: socialImage, width: 1200, height: 630, alt: "Spine — The backbone of your business" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spine — The backbone of your business",
    description,
    images: [socialImage],
  },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
