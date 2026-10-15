# B-16 · Document attachments stored in SharePoint (F-13)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `01-architecture.md` §6 (SharePoint row). PRD F-13: "Attach bottle drawings and supporting docs; stored in the organized SharePoint folder structure" (the structure Business Transformation is preparing for Ranger AI). Drawings are **requested, never required**.

## Inputs from M7 (Oct 27)
- Target SharePoint site + document library (`SP_SITE_ID`, `SP_DRIVE_ID`).
- IT has granted the API app **`Sites.Selected`** with `write` on that site only.
- The folder convention: default `/CCQ/{quote_number}/`. Align with Bailey's ERF restructure if it defines something else.

## Build
1. **`packages/integrations/graph/`:**
   - `GraphClient` uses `@azure/identity`: `ManagedIdentityCredential` in Azure; `ClientSecretCredential` from env locally (test site only).
   - `FileStore` interface:
     - `ensureFolder(path)`
     - `upload(path, stream, size, mime)` (Graph **upload session**, chunked 5 MB, for files up to 100 MB)
     - `list(path)`
     - `getDownloadUrl(itemId)` (short-lived)
     - `delete(itemId)` (admin only; soft delete preferred: move to `/CCQ/_removed/`)
   - Implementations:
     - `SharePointFileStore`
     - `BlobFileStore` (fallback, `@azure/storage-blob`, private container, user-delegation SAS)
     - `LocalFileStore` (dev, under `.data/files`)

     Selected by `FILESTORE_MODE`.
2. **API:**
   - `POST /api/v1/quotes/:qn/attachments`: multipart via `@fastify/multipart`, **streamed** to the store (never buffer whole files in memory).
     - Allowed types: pdf, png, jpg/jpeg, heic, dwg, dxf, step/stp, igs, xlsx, docx, msg/eml. Max 100 MB.
     - Fields: `kind` (bottle_drawing | spec | sample_photo | other) and an optional note.
   - `GET /api/v1/quotes/:qn/attachments`
   - `GET /api/v1/attachments/:id/download`: authz check, then 302 to a short-lived URL. Audited.
   - `DELETE /api/v1/attachments/:id`: uploader within 24 h, or Admin. Soft.
   - Permissions: `attachment.upload` per the matrix. Read follows `quote.read` scope.
3. **Side effects:**
   - Uploading a `bottle_drawing` sets `quote.drawing_status='have_drawing'` if it was anything else.
   - Writes an activity event (timeline) and an `audit_event` (upload and download).
4. **UI:**
   - A drop zone + camera capture on mobile (`accept` + `capture` for photos of samples) in intake step 4, replacing the B-07 placeholder, and an "Attachments" tab on quote detail.
   - The list shows kind, name, size, uploader and date, with download.
   - Upload progress, retry, and clear errors for type/size.
   - Intake drafts can hold attachments: upload into `/CCQ/_drafts/{draftId}/`, then move to the quote folder on submit (Graph move).

## Security
- `Sites.Selected` only, so the app can't see other sites.
- Verify the content type (magic bytes) as well as the extension.
- Files are scanned by Microsoft Defender for Office 365 / SharePoint per tenant policy (confirm with IT at M7).
- File names are sanitized; the original name is stored as metadata.

## Tests
- Contract tests for `FileStore` run against `LocalFileStore` and a mocked Graph.
- Streaming: a 50 MB upload with RSS memory growth < 50 MB.
- Authz: an owner-scoped KAM can't download another KAM's file; downloads are audited; the draft → quote move works.

## Acceptance
- [ ] Drawings upload from intake (including from a phone camera) and from any stage; stored in the SharePoint folder per quote
- [ ] Downloads are authorized and audited
- [ ] Blob fallback works by config switch alone
- [ ] Tick B-16 in `docs/build-guide/03-build-steps.md`, recording the site/folder agreed at M7
