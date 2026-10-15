import { useAuth } from './context';
import { DevPersonaSwitcher } from './DevPersonaSwitcher';
import { useCurrentUser } from './hooks';

export function UserMenu() {
  const me = useCurrentUser();
  const { session } = useAuth();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {me.authMode === 'dev' && <DevPersonaSwitcher />}
      <span data-testid="current-user">
        {me.user.displayName}
        <span className="text-muted-foreground ml-1 text-xs">({me.roles.join(', ')})</span>
      </span>
      {me.authMode === 'entra' && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground underline"
          onClick={() => void session.signOut()}
        >
          Sign out
        </button>
      )}
    </div>
  );
}
