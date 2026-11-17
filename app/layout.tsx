import type { Metadata } from "next";
import LanguageBar from "./components/Language";
import AppState from "./components/AppState";
import Notifications from "./components/Notifications";
import CoachProvider from "./components/Coach";
import NavigationFrame from "./components/NavigationFrame";
import "./globals.css";
import "./landing.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ballerrs.netlify.app"),
  title: "BALLERS — твой футбол",
  description:
    "Любительский футбол: игры, команды и подтверждённая история игрока",
  icons: { icon: { url: "/ballers-icon.svg", type: "image/svg+xml" } },
  openGraph: {
    title: "BALLERS — твой футбол",
    description: "Игры, команды и твоя футбольная история",
    images: [
      { url: "/ballers-logo.png", width: 1200, height: 1200, alt: "BALLERS" },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LanguageBar />
        <AppState>
          <CoachProvider>
            <Notifications>
              <NavigationFrame>{children}</NavigationFrame>
            </Notifications>
          </CoachProvider>
        </AppState>
      </body>
    </html>
  );
}
