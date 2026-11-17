import { Link } from '@tanstack/react-router';
import { CompassIcon, LockIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Centered branded panel used by the sign-in, loading and error states. */
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="bg-background flex min-h-dvh flex-col">
      <div className="bg-header h-2" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <p className="text-emphasis text-xs font-semibold tracking-widest uppercase">
              Pretium Packaging
            </p>
            <CardTitle>
              <h1 className="font-display text-3xl font-normal">{title}</h1>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          {children && <CardContent className="grid gap-3">{children}</CardContent>}
        </Card>
      </div>
    </main>
  );
}

const buttonClass = buttonVariants({ variant: 'action' });

export function SignInPage({ onSignIn, busy }: { onSignIn: () => void; busy?: boolean }) {
  return (
    <AuthPanel
      title="QuoteFlow"
      description="Commercial Capital Quoting. Sign in with your Pretium Microsoft account."
    >
      <button type="button" className={buttonClass} onClick={onSignIn} disabled={busy}>
        {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
      </button>
    </AuthPanel>
  );
}

export function LoadingPage({ message = 'Signing you in…' }: { message?: string }) {
  return <AuthPanel title="QuoteFlow" description={message} />;
}

function ShellMessage({
  icon: Icon,
  title,
  children,
  testId,
}: {
  icon: typeof LockIcon;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mx-auto grid max-w-md justify-items-center gap-3 py-12 text-center"
    >
      <span className="bg-secondary text-secondary-foreground flex size-14 items-center justify-center rounded-full">
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl">{title}</h1>
      {children}
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Back to the Command Center
      </Link>
    </div>
  );
}

/** 403: the signed-in user lacks the role or permission (from the API or a route guard). */
export function ForbiddenPage({ detail }: { detail?: string | undefined }) {
  return (
    <ShellMessage icon={LockIcon} title="You don’t have access to this" testId="forbidden">
      <p className="text-muted-foreground text-sm" role="alert">
        {detail ?? 'Your QuoteFlow role doesn’t allow this page.'} If you think you should, ask an
        admin or IT to check your SG-CCQ group membership.
      </p>
    </ShellMessage>
  );
}

/** 404 for unknown client routes. */
export function NotFoundPage() {
  return (
    <ShellMessage icon={CompassIcon} title="Page not found" testId="not-found">
      <p className="text-muted-foreground text-sm">
        That address doesn’t match a QuoteFlow page. Check the link, or start again from the Command
        Center.
      </p>
    </ShellMessage>
  );
}

/**
 * Signed in, but with no QuoteFlow role. UX-016: "Check again" asks for a fresh token and looks again,
 * so someone IT has just added to a group gets in without signing out of Microsoft.
 */
export function NoRolePage({
  detail,
  onSignOut,
  onCheckAgain,
  checking = false,
  checked = false,
}: {
  detail?: string | undefined;
  onSignOut?: () => void;
  onCheckAgain?: () => void;
  /** A check is under way. */
  checking?: boolean;
  /** A check has finished and the answer was still "no role" (this page is showing again). */
  checked?: boolean;
}) {
  return (
    <AuthPanel
      title="No QuoteFlow access yet"
      description={detail ?? 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group.'}
    >
      {onCheckAgain && (
        <>
          <div className="text-foreground-2 grid gap-1 text-sm">
            <p>If IT has just added you to a group, press Check again.</p>
            {/* Always in the page, so a screen reader hears the answer when it arrives. */}
            <p role="status" data-testid="recheck">
              {checked && !checking
                ? 'Still no access. If you were added a moment ago, wait a few minutes and check again.'
                : null}
            </p>
          </div>
          <button type="button" className={buttonClass} onClick={onCheckAgain} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </>
      )}
      {onSignOut && (
        <button
          type="button"
          className={onCheckAgain ? buttonVariants({ variant: 'outline' }) : buttonClass}
          onClick={onSignOut}
        >
          Sign out
        </button>
      )}
    </AuthPanel>
  );
}

export function AuthErrorPage({ message }: { message: string }) {
  return (
    <AuthPanel title="Can’t reach QuoteFlow" description={message}>
      <button type="button" className={buttonClass} onClick={() => window.location.reload()}>
        Try again
      </button>
    </AuthPanel>
  );
}
