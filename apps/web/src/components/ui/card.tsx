import * as React from 'react';

import { SectionToggle } from '@/components/SectionToggle';
import { useCollapsible } from '@/lib/collapse';
import { cn } from '@/lib/utils';

/**
 * A `collapsible` card (a section someone fills in) gets a chevron in its header that hides its content
 * and footer. They stay mounted, so a half-typed form survives being collapsed. See `lib/collapse`.
 */
interface Collapse {
  collapsed: boolean;
  toggle: () => void;
  bodyId: string;
  root: React.RefObject<HTMLDivElement | null>;
}
const CollapseContext = React.createContext<Collapse | null>(null);

const cardClass =
  'bg-card text-card-foreground rounded-card shadow-card flex flex-col gap-4 border py-5';

function Card({
  className,
  collapsible,
  ...props
}: React.ComponentProps<'div'> & { collapsible?: boolean }) {
  if (collapsible) return <CollapsibleCard className={className} {...props} />;
  return <div data-slot="card" className={cn(cardClass, className)} {...props} />;
}

function CollapsibleCard({ className, ...props }: React.ComponentProps<'div'>) {
  const root = React.useRef<HTMLDivElement>(null);
  const { collapsed, toggle } = useCollapsible(root);
  const bodyId = React.useId();
  return (
    <CollapseContext.Provider value={{ collapsed, toggle, bodyId, root }}>
      <div
        ref={root}
        data-slot="card"
        data-collapsed={collapsed}
        className={cn(cardClass, className)}
        {...props}
      />
    </CollapseContext.Provider>
  );
}

function CardHeader({ className, children, ...props }: React.ComponentProps<'div'>) {
  const collapse = React.useContext(CollapseContext);
  if (!collapse) {
    return (
      <div data-slot="card-header" className={cn('grid gap-1.5 px-5', className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <div data-slot="card-header" className="flex items-start gap-2 px-5" {...props}>
      <div className={cn('grid min-w-0 flex-1 gap-1.5', className)}>{children}</div>
      <SectionToggle
        collapsed={collapse.collapsed}
        onToggle={collapse.toggle}
        controls={collapse.bodyId}
        headingRoot={collapse.root}
      />
    </div>
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-snug font-semibold', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  const collapse = React.useContext(CollapseContext);
  return (
    <div
      data-slot="card-content"
      id={collapse?.bodyId}
      hidden={collapse?.collapsed || undefined}
      className={cn('px-5', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  const collapse = React.useContext(CollapseContext);
  return (
    <div
      data-slot="card-footer"
      hidden={collapse?.collapsed || undefined}
      className={cn('flex flex-wrap items-center gap-2 px-5', className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
