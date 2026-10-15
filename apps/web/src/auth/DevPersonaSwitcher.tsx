import { useAuth } from './context';

/** AUTH_MODE=dev only: pick which synthetic persona the API sees. */
export function DevPersonaSwitcher() {
  const { dev } = useAuth();
  if (!dev) return null;
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-950">DEV</span>
      <span className="sr-only">Persona</span>
      <select
        aria-label="Dev persona"
        data-testid="dev-persona"
        className="rounded border px-1 py-0.5"
        value={dev.persona}
        onChange={(e) => dev.setPersona(e.target.value)}
      >
        {dev.personas.map((p) => (
          <option key={p.key} value={p.key}>
            {p.key} ({p.roles.join(', ')}
            {p.scope.type === 'all' ? '' : `; ${p.scope.type}`})
          </option>
        ))}
      </select>
    </label>
  );
}
