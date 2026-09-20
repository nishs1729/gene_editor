// A one-slot registry for the live canvas's imperative handles.
// Toolbar menus and dialogs need to scroll or measure the canvas, which only the
// mounted SequenceCanvas can do. Passing that down through props would thread a
// ref through most of the tree for a handful of one-off calls.

let api = null;

/** Called by SequenceCanvas on mount; returns the matching unregister. */
export function registerCanvasApi(next) {
  api = next;
  return () => {
    if (api === next) api = null;
  };
}

/** The live canvas handles, or null when no canvas is mounted. */
export function getCanvasApi() {
  return api;
}
