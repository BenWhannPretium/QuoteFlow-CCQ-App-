import type { ReactNode } from 'react';

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
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            Pretium Packaging
          </p>
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent className="grid gap-3">{children}</CardContent>}
      </Card>
    </div>
  );
}

const buttonClass =
  'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50';

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

/** 403 from the API: the signed-in user lacks the role or permission. */
export function ForbiddenPage({ detail }: { detail?: string | undefined }) {
  return (
    <div role="alert" className="mx-auto grid max-w-md gap-2 py-12 text-center">
      <h1 className="text-xl font-semibold">You don’t have access to this</h1>
      <p className="text-muted-foreground text-sm">
        {detail ?? 'Your QuoteFlow role doesn’t allow this action.'} If you think you should, ask an
        admin or IT to check your SG-CCQ group membership.
      </p>
    </div>
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
