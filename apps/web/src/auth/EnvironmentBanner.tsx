import type { AppEnvironment } from '@ccq/contracts';
import { useEffect } from 'react';

import { setDocumentTitlePrefix } from '@/shell/useDocumentTitle';

const BANNERS: Partial<Record<AppEnvironment, { tag: string; text: string }>> = {
  test: {
    tag: 'TEST',
    text: 'Test environment. Not production: quotes and decisions here are not live.',
  },
  unset: {
    tag: 'NOT PROD',
    text: 'Environment not set (APP_ENVIRONMENT). Treat this as a test system.',
  },
};

/**
 * A strip above everything, the sign-in page included, on any deployment that isn't prod: test and
 * prod share one Entra sign-in and look the same otherwise. Also prefixes the tab title. Local dev has
 * its own DEV bar, so nothing shows there.
 */
export function EnvironmentBanner({ environment }: { environment: AppEnvironment }) {
  const banner = BANNERS[environment];
  useEffect(() => {
    setDocumentTitlePrefix(banner ? `[${banner.tag}] ` : '');
  }, [banner]);
  if (!banner) return null;
  return (
    <div
      role="status"
      data-testid="environment-banner"
      className="bg-warning text-warning-foreground flex items-center gap-2 px-4 py-1 text-xs"
    >
      <span className="font-bold tracking-wider">{banner.tag}</span>
      <span>{banner.text}</span>
    </div>
  );
}
