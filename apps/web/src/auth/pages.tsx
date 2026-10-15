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
        Back to home
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
        That address doesn’t match a QuoteFlow page. Check the link, or start again from home.
      </p>
    </ShellMessage>
  );
}

export function NoRolePage({
  detail,
  onSignOut,
}: {
  detail?: string | undefined;
  onSignOut?: () => void;
}) {
  return (
    <AuthPanel
      title="No QuoteFlow access yet"
      description={detail ?? 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group.'}
    >
      {onSignOut && (
        <button type="button" className={buttonClass} onClick={onSignOut}>
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
