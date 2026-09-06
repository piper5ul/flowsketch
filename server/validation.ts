/**
 * Request-body schemas for the diagram API.
 *
 * The schemas are deliberately *loose* about unknown keys: a parsed body is
 * what gets written to `Diagram.data`, so stripping keys the client sent would
 * be silent data loss the next time the client learns a new field. What they
 * are strict about is the shape of the fields we do know (`shared/types.ts`)
 * and the size of what a single request may store.
 */
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { MAX_THUMBNAIL_CHARS, THUMBNAIL_DATA_URL_PREFIX } from '../shared/types.js';

/** Ceiling on `nodes` and `edges` per diagram. Well past any hand-drawn board. */
export const MAX_ELEMENTS = 5000;
/** Ceiling on a diagram title. */
export const MAX_TITLE_CHARS = 200;
/** Ceiling on a node/edge id. Client ids are nanoids; this only stops abuse. */
export const MAX_ID_CHARS = 64;

const elementId = z.string().min(1).max(MAX_ID_CHARS);

/**
 * Free-form bag: node/edge `data` is `Record<string, unknown>` by design.
 * Typed as JSON rather than `unknown` so the parsed body can go straight into
 * a Prisma `Json` column without a cast.
 */
const dataBag = z.record(z.string(), z.json());

/** Unknown keys are kept, not stripped: see the note at the top of the file. */
const unknownKeys = z.json();

const serializedNode = z.object({
  id: elementId,
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  data: dataBag.optional(),
}).catchall(unknownKeys);

const serializedEdge = z.object({
  id: elementId,
  source: elementId,
  target: elementId,
  type: z.string().optional(),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  zIndex: z.number().optional(),
  // Arrowheads are regenerated from `data` by the client; the server only
  // stores whatever it was handed.
  markerStart: z.json().optional(),
  markerEnd: z.json().optional(),
  data: dataBag.optional(),
}).catchall(unknownKeys);

/** `DiagramData` from `shared/types.ts`: the persisted body of a diagram. */
export const diagramData = z.object({
  nodes: z.array(serializedNode).max(MAX_ELEMENTS),
  edges: z.array(serializedEdge).max(MAX_ELEMENTS),
}).catchall(unknownKeys);

const title = z.string().trim().min(1).max(MAX_TITLE_CHARS);

/**
 * A dashboard thumbnail, as the base64 PNG data URL the client renders. Kept
 * to one format on purpose: the value is echoed straight into an `<img src>`,
 * so anything the browser would treat as markup (an SVG data URL) or fetch
 * from elsewhere (an http URL) has no business being stored here.
 */
const thumbnail = z
  .string()
  .max(MAX_THUMBNAIL_CHARS)
  .startsWith(THUMBNAIL_DATA_URL_PREFIX, `Expected a ${THUMBNAIL_DATA_URL_PREFIX} data URL`)
  .nullable();

/** `POST /api/diagrams`. Both fields have server-side defaults. */
export const createDiagramBody = z.strictObject({
  title: title.optional(),
  data: diagramData.optional(),
});

/** The fields a `PUT` can actually write. `ifUnmodifiedSince` is a guard, not one of them. */
const UPDATABLE_FIELDS = ['title', 'data', 'starred', 'thumbnail'] as const;

/** `PUT /api/diagrams/:id`. A patch: whatever is present is what gets written. */
export const updateDiagramBody = z
  .strictObject({
    title: title.optional(),
    data: diagramData.optional(),
    starred: z.boolean().optional(),
    thumbnail: thumbnail.optional(),
    /**
     * Optimistic concurrency guard: the `updatedAt` the client last saw. The
     * write is refused with a 409 when the row has moved on since — that is
     * what stops a second tab from silently overwriting the first.
     */
    ifUnmodifiedSince: z.iso.datetime().optional(),
  })
  .refine((body) => UPDATABLE_FIELDS.some((field) => body[field] !== undefined), {
    error: 'Expected at least one of title, data, starred or thumbnail',
  });

/** Ceiling on an invited address. Comfortably past RFC 5321's 254. */
export const MAX_EMAIL_CHARS = 254;

/**
 * `POST /api/diagrams/:id/members`.
 *
 * The address is lower-cased before it is looked up, because that is how
 * BetterAuth stores it and an invitation typed with a capital should still
 * find the account. `role` is an enum here rather than in the database: the
 * column is a String so that adding a role is a deploy, not a migration.
 */
export const addMemberBody = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_CHARS)),
  role: z.enum(['editor', 'viewer']),
});

export type AddMemberBody = z.infer<typeof addMemberBody>;

/** Ceiling on a manual snapshot's label. A caption, not a changelog. */
export const MAX_VERSION_LABEL_CHARS = 100;

/**
 * `POST /api/diagrams/:id/versions`.
 *
 * The body is optional in full: "snapshot this, unlabelled" is a `POST` with
 * nothing in it, and Express 5 leaves `req.body` undefined when no JSON was
 * sent — hence `nullish()` and the transform that normalises both to `{}`.
 */
export const createVersionBody = z
  .strictObject({
    label: z.string().trim().min(1).max(MAX_VERSION_LABEL_CHARS).optional(),
  })
  .nullish()
  .transform((body) => body ?? {});

export type CreateVersionBody = z.infer<typeof createVersionBody>;

/** Appended by `POST /api/diagrams/:id/duplicate`. */
export const COPY_SUFFIX = ' (copy)';

/**
 * Names the copy a duplicate produces. Duplicating a diagram whose title is
 * already at the limit must not create a row the API would then refuse to
 * accept back, so the original is trimmed to make room for the suffix.
 */
export function copyTitle(title: string): string {
  const room = MAX_TITLE_CHARS - COPY_SUFFIX.length;
  return `${title.length > room ? title.slice(0, room).trimEnd() : title}${COPY_SUFFIX}`;
}

export type CreateDiagramBody = z.infer<typeof createDiagramBody>;
export type UpdateDiagramBody = z.infer<typeof updateDiagramBody>;

/** One zod issue, flattened to a dotted path a client can log or show. */
export interface BodyIssue {
  path: string;
  message: string;
}

export function flattenIssues(error: z.ZodError): BodyIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parse `req.body` with `schema`, answering `400 { error, issues }` when it
 * does not fit. On success `req.body` is replaced with the parsed value, so
 * handlers see trimmed titles rather than the raw input.
 */
export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid body', issues: flattenIssues(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}
