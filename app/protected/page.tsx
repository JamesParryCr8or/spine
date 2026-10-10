import { AnalyticsApp } from "@/components/analytics-app";

export default async function ProtectedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { view } = await searchParams;
  // ?view= picks the screen, so a refresh or shared link reopens it.
  return <AnalyticsApp initialViewSlug={typeof view === "string" ? view : null} />;
}
