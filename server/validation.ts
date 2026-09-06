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

/** `POST /api/diagrams`. Both fields have server-side defaults. */
export const createDiagramBody = z.strictObject({
  title: title.optional(),
  data: diagramData.optional(),
});

/** `PUT /api/diagrams/:id`. A patch: whatever is present is what gets written. */
export const updateDiagramBody = z
  .strictObject({
    title: title.optional(),
    data: diagramData.optional(),
    starred: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Expected at least one of title, data or starred',
  });

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
