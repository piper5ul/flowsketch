# Changelog

FlowSketch is deployed continuously from `main`; releases are cut by date when a
body of work lands. Newest first.

## 2026.09.24 — Connectors that behave like Whimsical's

The connector was studied side by side with Whimsical's — drawing, dragging
ends onto shapes and off into space, pulling them round — and rebuilt to follow
the same rules. Typing into shapes got the same treatment.

### Connectors

- **Free ends.** Releasing the connector tool, or a shape's side handle, on
  empty board leaves the end dangling there, snapped to the grid, instead of
  dropping a new 180×100 box you then had to delete.
- **Dragging an end goes where you point.** An end dragged over a shape
  attaches to it (the shape is outlined while you hover); dragged anywhere else
  it is left free. It used to snap to whichever shape on the board happened to
  be nearest — sometimes the connector's own source.
- **The other end stays put.** The end you are not dragging never moves and
  never changes side, and a free end is approached along the line the
  connector set off on: leave a shape's bottom edge and the arrow arrives
  vertically, downward if the end is below and upward if it is above.
- **A new elbow router.** The A\* router (extracted from JointJS) gave up on
  ordinary cases and fell back to lines that ignored which way each end faces
  — arrows running into a free end sideways, or turning straight back along a
  shape's edge. Its replacement is deterministic and follows Whimsical's
  rules: each end leaves and arrives square to its side, the route takes the
  fewest corners (an L before a Z), a Z splits halfway across the gap, shapes
  and frames in the way are walked round with 20 px to spare, bends you drag
  in are passed through without doubling back, and a route always arrives.
- **Arrowheads on a selected connector are back.** Selecting a connector
  recoloured its heads with a reference the browser ignored, so they vanished.
- A connector you have just drawn opens its label for typing, and the floating
  toolbar fades out of the way while an end is being dragged.
- Earlier in the week, straight to `main`: anchors shown on hovered and
  selected shapes, a real arrow (with its head) as the draft while drawing,
  the select tool coming back after a handle-drag connection, and arrowheads
  highlighted with the selection.

### Typing

- **A shape placed from the rail opens for typing**, as in Whimsical: draw a
  box, type its name. Before, the letters typed next ran as tool shortcuts —
  a `t` in "account" armed the text tool and the next click dropped a stray
  text box.
- **One label editor for shapes, frames, wireframe parts and connector labels,
  and React keeps its hands off it while you type.** The text is written in
  once when editing starts and read back when it ends, and it is saved before
  the editor closes — so a render arriving mid-sentence (the box growing, a
  collaborator's change) can no longer put the old label back beside the new
  one. Quick-add buttons stay available while a new shape's label is open.

### Under the hood

- `src/lib/orthoRouter.ts` (new) replaces `src/lib/manhattanRouter.ts`.
- `src/components/EditableLabel.tsx` (new) replaces four hand-rolled
  `contentEditable` editors.
- Store: `freeEdgeEndpoint`, orphaned free-end anchors removed on re-attach,
  and a transient `connectorDragging` flag.
- Tests: router properties (square ends, fewest corners, centred Z, clearance,
  bends, always arrives), free-end store actions, and end-to-end runs for free
  ends, typing into new and existing shapes, and typing while a collaborator
  moves the same shape.

### Known issues

- Restoring a labelled snapshot from the history panel can leave the board
  showing the newer text (`e2e/diagram.spec.ts` — "a labelled snapshot can be
  taken and restored"). It fails the same way before this release and is next
  on the list.
- Connector ends attach to a shape's bounding box, so a line to an ellipse or
  a diamond meets the box rather than the curve.
