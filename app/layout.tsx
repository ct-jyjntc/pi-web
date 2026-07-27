import type { Metadata } from "next";
import { Inter, Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${inter.variable} ${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark"||(t!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark");var l=localStorage.getItem("pi-locale");if(l==="zh"||l==="en")document.documentElement.lang=l;else{var n=(navigator.language||"").toLowerCase();document.documentElement.lang=n.indexOf("zh")===0?"zh":"en"}if(window.piDesktop&&window.piDesktop.isDesktop){var r=document.documentElement;r.classList.add("pi-desktop");var p=window.piDesktop.platform;if(p==="darwin")r.classList.add("pi-desktop-mac");else if(p==="win32")r.classList.add("pi-desktop-win");else if(p==="linux")r.classList.add("pi-desktop-linux");if(typeof window.piDesktop.setTheme==="function"){window.piDesktop.setTheme(r.classList.contains("dark")?"dark":"light")}}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
