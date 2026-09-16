import type { Metadata } from "next";
import { ScoreboardScreen } from "@/features/scoreboard/scoreboard-screen";

export const metadata: Metadata = {
  title: "Court scoreboard",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DisplayPage() { return <ScoreboardScreen />; }
