import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "Kubernetes 한국어 문서 기여 현황",
  description: "2026년 7월 11일 이후 OSSCA 멤버들의 GitHub 기여 지표",
};

export default function Home() {
  return <Dashboard />;
}
