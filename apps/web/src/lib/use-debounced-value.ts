import { useEffect, useState } from 'react';

/** How long a queue's search box waits after the last keystroke (the Final Review queue's wait). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The value once it has stopped changing for `ms`. UX-017: the engineering and pricing queues' search
 * boxes asked the server on every keystroke; with this the request goes out when the typing pauses.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
