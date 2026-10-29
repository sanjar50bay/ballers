import type { Metadata } from "next";
import LanguageBar from "./components/Language";
import AppState from "./components/AppState";
import Notifications from "./components/Notifications";
import CoachProvider from "./components/Coach";
import "./globals.css";

export const metadata: Metadata = {
  title: "BALLERS — твой футбол",
  description:
    "Любительский футбол: игры, команды и подтверждённая история игрока",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LanguageBar />
        <AppState>
          <CoachProvider>
            <Notifications>{children}</Notifications>
          </CoachProvider>
        </AppState>
      </body>
    </html>
  );
}
