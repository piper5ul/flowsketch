import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../store/useDiagramStore';
import { toastError } from '../store/useToastStore';
import { TOO_LARGE_MESSAGE, downscaleImage, fitWithin, isImageTooLarge, uploadImage } from './imageUpload';

/**
 * Longest edge an inserted image is drawn at, in canvas pixels. A photo would
 * otherwise land as a wall the rest of the diagram has to live around; the
 * user can always resize it back up.
 */
export const INSERTED_MAX_EDGE_PX = 400;

/** The box the "Uploading…" placeholder occupies before the size is known. */
const PLACEHOLDER_SIZE = { width: 220, height: 150 };

/** Each further image in one drop or paste steps down-right from the last. */
const CASCADE_PX = 28;

/** Centres a box of `size` on `centre`. */
function boxAround(centre: { x: number; y: number }, size: { width: number; height: number }) {
  return { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
}

/**
 * Inserts image files into the diagram: downscale, upload, then swap the
 * returned `/api/images/<id>` URL into the node that was holding its place.
 *
 * Every entry point — paste, drop, the rail's file picker — goes through this,
 * so they all get the same size cap, the same placeholder and the same error
 * reporting.
 */
export function useImageInsert() {
  const { screenToFlowPosition } = useReactFlow();

  return useCallback(
    (files: readonly Blob[], screenPoint?: { x: number; y: number }) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;

      const point = screenPoint ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const anchor = screenToFlowPosition({ x: point.x, y: point.y });

      images.forEach((file, index) => {
        const centre = { x: anchor.x + index * CASCADE_PX, y: anchor.y + index * CASCADE_PX };

        // Checked against the original: the server's ceiling is about what the
        // user is asking us to read, and a 40 MB file is a mistake worth
        // naming rather than something to spend a minute downscaling.
        if (isImageTooLarge(file)) {
          toastError(TOO_LARGE_MESSAGE);
          return;
        }

        const store = useDiagramStore.getState();
        const placeholderId = store.addImagePlaceholder({
          ...PLACEHOLDER_SIZE,
          position: boxAround(centre, PLACEHOLDER_SIZE),
        });

        void (async () => {
          try {
            const scaled = await downscaleImage(file);
            const meta = await uploadImage(scaled.blob);
            // Prefer the server's own reading of the pixels; it sniffs the
            // bytes rather than trusting anything the client claims.
            const size = fitWithin(
              meta.width ?? scaled.width,
              meta.height ?? scaled.height,
              INSERTED_MAX_EDGE_PX,
            );
            useDiagramStore.getState().resolveImagePlaceholder(placeholderId, {
              src: meta.url,
              width: size.width,
              height: size.height,
              position: boxAround(centre, size),
            });
          } catch (err) {
            useDiagramStore.getState().removeImagePlaceholder(placeholderId);
            // `uploadImage` throws messages written for this exact purpose;
            // anything else gets a generic one rather than leaking internals.
            toastError(err instanceof Error && err.message ? err.message : 'Could not add that image.');
          }
        })();
      });
    },
    [screenToFlowPosition],
  );
}
