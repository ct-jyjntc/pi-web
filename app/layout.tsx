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
            __html: `(function(){try{var m=localStorage.getItem("pi-theme-mode");var t=localStorage.getItem("pi-theme");var dark=false;if(m==="dark"||t==="dark")dark=true;else if(m==="light"||t==="light")dark=false;else dark=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");var a=localStorage.getItem("pi-appearance");if(a){try{var p=JSON.parse(a);if(p&&p.uiFontSize)document.documentElement.style.setProperty("--ui-font-size",p.uiFontSize+"px");if(p&&p.codeFontSize)document.documentElement.style.setProperty("--code-font-size",p.codeFontSize+"px")}catch(_){}}var l=localStorage.getItem("pi-locale");if(l==="zh"||l==="en")document.documentElement.lang=l;else{var n=(navigator.language||"").toLowerCase();document.documentElement.lang=n.indexOf("zh")===0?"zh":"en"}if(window.piDesktop&&window.piDesktop.isDesktop){var r=document.documentElement;r.classList.add("pi-desktop");var plat=window.piDesktop.platform;if(plat==="darwin")r.classList.add("pi-desktop-mac");else if(plat==="win32")r.classList.add("pi-desktop-win");else if(plat==="linux")r.classList.add("pi-desktop-linux");if(typeof window.piDesktop.setTheme==="function"){window.piDesktop.setTheme(r.classList.contains("dark")?"dark":"light")}}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
