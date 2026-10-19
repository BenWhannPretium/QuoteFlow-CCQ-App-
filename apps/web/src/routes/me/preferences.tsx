import type { EmailPreference, PreferencesResponse } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import { useState } from 'react';

import { ErrorState, PageHeader, SkeletonRows } from '@/components';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/me/preferences')({ component: PreferencesPage });

const preferencesQueryKey = ['preferences'] as const;

const DELIVERY: Record<EmailPreference['delivery'], string> = {
  immediate: 'Sent as it happens',
  daily_digest: 'One email each morning',
};

/**
 * Email preferences (B-18): one switch per event that has an email. In-app notifications always show
 * and cannot be turned off. A change saves at once. Emails never carry pricing or capital figures.
 */
function PreferencesPage() {
  useDocumentTitle('Email preferences');
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: preferencesQueryKey, queryFn: () => api.preferences() });
  // A switch moves the moment it is clicked (local state, applied in the same render as the click),
  // then the server's answer replaces it. A failure drops it, showing the saved value again.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const save = useMutation({
    mutationFn: (change: { type: string; enabled: boolean }) =>
      api.updatePreferences({ email: { [change.type]: change.enabled } }),
    onSuccess: (next) => queryClient.setQueryData<PreferencesResponse>(preferencesQueryKey, next),
    onError: (err) => {
      const { title, message } = describeError(err);
      toast.error({ title, description: message, key: 'preferences-save' });
    },
    onSettled: (_data, _error, change) =>
      setPending((now) => {
        if (now[change.type] !== change.enabled) return now; // a newer click is still in flight
        const { [change.type]: _done, ...rest } = now;
        return rest;
      }),
  });

  return (
    <div className="grid max-w-3xl gap-4" data-testid="preferences-page">
      <PageHeader
        className="mb-0"
        title="Email preferences"
        description="Choose which events also arrive by email. In-app notifications always show in the bell and cannot be switched off. Emails never include pricing or capital figures."
        actions={
          <Link
            to="/notifications"
            className="text-emphasis text-sm font-medium underline-offset-4 hover:underline"
          >
            Back to notifications
          </Link>
        }
      />
      {prefs.isPending ? (
        <SkeletonRows rows={6} />
      ) : prefs.isError ? (
        <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />
      ) : (
        <>
          {!prefs.data.emailAvailable && (
            <p
              role="status"
              className="bg-secondary text-secondary-foreground rounded-card flex gap-2 p-3 text-sm"
              data-testid="email-off-note"
            >
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              QuoteFlow is not sending email right now, so everything shows in the app only. Your
              choices below are saved for when email is back.
            </p>
          )}
          <Card className="gap-0 p-2">
            <ul className="divide-y">
              {prefs.data.email.map((p) => {
                const id = `pref-${p.type}`;
                return (
                  <li key={p.type} className="px-2 py-1">
                    <label
                      htmlFor={id}
                      className="flex min-h-11 cursor-pointer items-start gap-3 py-2"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="accent-primary mt-1 size-5 shrink-0"
                        checked={pending[p.type] ?? p.enabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setPending((now) => ({ ...now, [p.type]: enabled }));
                          save.mutate({ type: p.type, enabled });
                        }}
                        data-testid={id}
                      />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{p.label}</span>
                        <span className="text-muted-foreground text-xs">{p.description}</span>
                        <span className="text-muted-foreground text-xs">
                          {DELIVERY[p.delivery]}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
