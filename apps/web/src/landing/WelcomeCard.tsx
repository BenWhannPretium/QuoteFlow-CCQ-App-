import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

import { quickstartHref } from './quickstart';
import { WELCOME_INTRO, WELCOME_TITLE, welcomeJobsFor } from './welcome';

/**
 * The first-run card on the Command Center (see `welcome.ts`): the role's three main jobs and where each
 * is done, the link to the role's one-page quick-start, and "Got it" to put it away for good.
 */
export function WelcomeCard({
  role,
  roleLabel,
  onDismiss,
}: {
  role: string;
  roleLabel: string;
  onDismiss: () => void;
}) {
  const headingId = useId();
  const jobs = welcomeJobsFor(role);
  if (!jobs) return null;
  return (
    <section aria-labelledby={headingId} className="mb-5" data-testid="welcome-card">
      <Card className="border-l-action border-l-4">
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="text-base font-semibold">
              {WELCOME_TITLE}
            </h2>
          </CardTitle>
          <p className="text-muted-foreground text-sm">{WELCOME_INTRO}</p>
        </CardHeader>
        <CardContent>
          <ul className="grid list-disc gap-1.5 pl-5 text-sm" data-testid="welcome-jobs">
            {jobs.map((j) => (
              <li key={j.job}>
                {j.job}: <strong className="font-semibold">{j.where}</strong>.
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="justify-between gap-x-4">
          <a
            href={quickstartHref(role)}
            target="_blank"
            rel="noreferrer"
            // 44 px tap target on phones (mobile.spec.ts).
            className="text-emphasis inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-0"
            data-testid="welcome-quickstart"
          >
            Read the one-page quick-start for {roleLabel}
          </a>
          <Button variant="outline" size="sm" onClick={onDismiss} data-testid="welcome-dismiss">
            Got it
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
