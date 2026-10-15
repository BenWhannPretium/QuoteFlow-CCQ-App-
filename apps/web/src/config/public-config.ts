import type { PublicConfigResponse } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const publicConfigQueryKey = ['config', 'public'] as const;

/**
 * Labels, value lists, reason codes and UI settings from `GET /config/public`. Cached for the
 * session (config changes rarely; B-19 invalidates this key after an admin edit).
 */
export function usePublicConfig() {
  return useQuery({
    queryKey: publicConfigQueryKey,
    queryFn: api.publicConfig,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  });
}

/** Stage label from config; the key itself until config loads (never a hard-coded label). */
export const stageLabel = (config: PublicConfigResponse | undefined, key: string): string =>
  config?.stages.find((s) => s.key === key)?.label ?? key;

export const gateOutcomes = (config: PublicConfigResponse | undefined, gateKey: string) =>
  (config?.outcomes ?? []).filter((o) => o.gateKey === gateKey);

export const reasonCodesFor = (config: PublicConfigResponse | undefined, context: string | null) =>
  context ? (config?.reasonCodes ?? []).filter((r) => r.context === context) : [];

export function useStageLabel(key: string): string {
  const { data } = usePublicConfig();
  return stageLabel(data, key);
}

export function useValueList(listKey: string) {
  const { data } = usePublicConfig();
  return data?.valueLists[listKey] ?? [];
}
