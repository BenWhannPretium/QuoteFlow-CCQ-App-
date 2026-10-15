import { useId } from 'react';

import { useAuth } from './context';

/**
 * AUTH_MODE=dev only: a strip above the header to pick which synthetic persona the API sees.
 * Renders nothing against an Entra-mode API.
 */
export function DevPersonaSwitcher() {
  const { dev } = useAuth();
  const id = useId();
  if (!dev) return null;
  return (
    <div
      data-testid="dev-bar"
      className="bg-warning text-warning-foreground flex items-center gap-2 px-4 py-1 text-xs"
    >
      <span className="font-bold tracking-wider">DEV</span>
      <span className="hidden sm:inline">Fake sign-in. Local development only.</span>
      <label htmlFor={id} className="ml-auto">
        Persona
      </label>
      <select
        id={id}
        data-testid="dev-persona"
        className="border-warning-foreground/40 min-h-8 max-w-[60vw] rounded border bg-transparent px-1 text-xs"
        value={dev.persona}
        onChange={(e) => dev.setPersona(e.target.value)}
      >
        {dev.personas.map((p) => (
          <option key={p.key} value={p.key} className="bg-card text-foreground">
            {p.key} ({p.roles.join(', ')}
            {p.scope.type === 'all' ? '' : `; ${p.scope.type}`})
          </option>
        ))}
      </select>
    </div>
  );
}
