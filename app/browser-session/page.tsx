import { getTranslations } from "next-intl/server";
import { BrowserSessionViewer } from "@/components/browser-session/browser-session-viewer";

interface BrowserSessionPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BrowserSessionPage({
  searchParams,
}: BrowserSessionPageProps) {
  const t = await getTranslations("browserSession");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawSessionId = resolvedSearchParams?.sessionId;
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-white/50 font-mono text-sm">
        {t("noSessionId")}
      </div>
    );
  }

  return <BrowserSessionViewer sessionId={sessionId} />;
}
