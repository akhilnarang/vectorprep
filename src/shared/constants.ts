/** A page whose raster images total more than this many megapixels is "huge raster". */
export const HUGE_MP = 50;
/** Embedded images larger than this are not decoded for "original image" export. */
export const MAX_DECODE_MP = 100;
/** Margin added around an element export, in real-world millimetres. */
export const ELEMENT_MARGIN_MM = 2;

// Artwork checks ("fake vector" files). Refer to docs/architecture.md, "Artwork checks".
/** "Many objects": more drawing operations (or filled paths) than this on one artboard. */
export const MANY_OBJECTS = 50_000;
/** Pixel image as vectors: at least this many filled, axis-aligned rectangles. */
export const PIXEL_MIN_RECTS = 5_000;
/** ... and the rectangles are at least this share of all filled subpaths. */
export const PIXEL_RECT_SHARE = 0.8;
/** A size is a unit candidate if it is at least this share of all widths and heights. */
export const PIXEL_MIN_UNIT_SHARE = 0.05;
/** At least this share of the widths, and of the heights, must be whole multiples of the unit. */
export const PIXEL_ON_GRID = 0.9;
/** The source image must be at least this many pixels on its longer side. */
export const PIXEL_MIN_SOURCE_PX = 64;
/** Traced image: at least this many filled paths. */
export const TRACED_MIN_FILLS = 500;
/** ... and at least this many different fill colours. */
export const TRACED_MIN_COLOURS = 16;
/** ... at least this share of the filled paths have curves. */
export const TRACED_MIN_CURVED_SHARE = 0.5;
/** ... and at most this many strokes for each filled path. */
export const TRACED_MAX_STROKE_SHARE = 0.02;
/** The checks read at most this many decoded content bytes for each artboard. */
export const SCAN_MAX_BYTES = 128 * 1024 * 1024;
/** Recommended minimum resolution for full-colour print. */
export const PRINT_MIN_DPI = 150;
