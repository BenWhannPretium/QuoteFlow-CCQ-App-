import type { AttachmentKindValue } from '@ccq/contracts';
import { acceptedFormats } from '@ccq/domain';


/**
 * FB-27 (N17-24): the formats and size limit an upload takes, in words beside its button. They come from
 * the lists the server checks (`acceptedFormats`), so the words, the file picker's `accept` and the rule
 * cannot drift apart. Give the paragraph an `id` and point the button's `aria-describedby` at it.
 */
export function UploadFormats({
  kind,
  id,
  className,
}: {
  kind: AttachmentKindValue;
  id?: string;
  className?: string;
}) {
  return (
    <p
      id={id}
      className={className ?? 'text-muted-foreground text-xs'}
      data-testid={`upload-formats-${kind}`}
    >
      {acceptedFormats(kind).text}
    </p>
  );
}

/** The `accept` string for a kind's file picker. */
export const acceptFor = (kind: AttachmentKindValue): string => acceptedFormats(kind).accept;
