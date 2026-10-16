import { BookmarkIcon, TrashIcon } from 'lucide-react';
import { useId, useReducer, useState } from 'react';

import { useCurrentUser } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { deleteView, listSavedViews, saveView } from '@/lib/saved-views';
import { toast } from '@/lib/toast';

/**
 * Saved views (B-14): name the current filters and come back to them. Kept in this browser only
 * (per user, per view); the URL itself is the shareable form.
 */
export function SavedViewsMenu({
  view,
  search,
  onApply,
}: {
  view: string;
  search: Record<string, unknown>;
  onApply: (search: Record<string, unknown>) => void;
}) {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // Saved views are read from storage on every render while open; `refresh` re-renders after a change.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const nameId = useId();
  const views = open ? listSavedViews(user.id, view) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="saved-views">
          <BookmarkIcon aria-hidden="true" />
          Views
        </Button>
      </PopoverTrigger>
      <PopoverContent className="grid w-72 gap-3" align="start">
        <p className="text-sm font-semibold">Saved views</p>
        {views.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. Saved views stay in this browser; share the page link instead.
          </p>
        ) : (
          <ul className="grid gap-1">
            {views.map((v) => (
              <li key={v.name} className="flex items-center gap-1">
                <button
                  type="button"
                  className="hover:bg-accent min-h-11 flex-1 truncate rounded-md px-2 text-left text-sm sm:min-h-9"
                  onClick={() => {
                    onApply(v.search);
                    setOpen(false);
                  }}
                >
                  {v.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:size-9"
                  aria-label={`Delete saved view ${v.name}`}
                  onClick={() => {
                    deleteView(user.id, view, v.name);
                    refresh();
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (saveView(user.id, view, name, search)) {
              toast.success({ title: 'View saved', description: `“${name.trim()}”` });
              setName('');
              refresh();
            } else {
              toast.error({
                title: 'Couldn’t save the view',
                description: name.trim()
                  ? 'This browser isn’t letting the app store it.'
                  : 'Give it a name.',
              });
            }
          }}
        >
          <label htmlFor={nameId} className="text-sm">
            Save the current filters as
          </label>
          <div className="flex gap-2">
            <Input
              id={nameId}
              value={name}
              maxLength={60}
              placeholder="e.g. My aged reviews"
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
