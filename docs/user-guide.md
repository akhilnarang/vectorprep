# User guide

This guide tells you how to prepare a client file for CorelDRAW with this tool.

The tool runs in your browser. Your files stay on your computer.

## 1. Open a file

1. Open the tool in a current version of Chrome or Edge. The tool was tested in Chromium. Firefox and Safari were not tested.
2. Drag the .ai or .pdf file onto the page. You can drop the file anywhere on the page.
3. As an alternative, click the drop area and select the file. The drop area shows **Drop an .ai or .pdf file on this page**.

The tool shows its progress at the top of the page. On the test computer, a 150 MB file opened in less than one second.

If you open a new file, the tool closes the current file. To close the file without a new file, click **Close file**.

## 2. Read the report

The tool shows one card for each artboard. In a PDF, each page is one artboard.

Each card shows these items:

- A preview. The tool makes the preview when you scroll to the card.
- The artboard number and a status badge.
- The size in millimetres and in points.
- The raster images on the artboard, with their size in pixels and megapixels (MP).
- The fonts on the artboard, if there is live text.
- The artwork counts: drawing operations, filled paths and fill colours. If the artwork is a pixel image made of rectangles, the card also shows the size of the source image and its resolution.

### Status badges

| Badge | Meaning | What to do |
| --- | --- | --- |
| Vector | The artboard has only vector artwork. | Export it. |
| Vector and raster | The artboard has vector artwork and one or more raster images. | Export it. Check the image sizes in the card. |
| Live fonts | The artboard has text that is not converted to outlines. | Read "Live fonts" in section 8. |
| Large raster: not selected | The raster images on the artboard are larger than 50 MP in total. | Do not export it. Read "Large raster artboards" in section 8. |
| Pixel image as vectors | The artwork is a pixel image. Each pixel, or each row of pixels with the same colour, is a small vector rectangle. | Read "Pixel image as vectors" in section 8. |
| Traced image | The artwork looks like a raster image that was traced into flat-colour shapes. | Read "Traced image" in section 8. |
| Many objects | The artboard has more than 50,000 drawing operations or filled paths. This badge can show together with other badges. | Read "Very many objects" in section 8. |

The tool examines the artwork when it opens the file. The "Pixel image as vectors" and "Traced image" checks are estimates. They can be wrong. Always look at the artwork in the viewer.

### UserUnit

Some Illustrator files use a large canvas. These files store a scale factor named "UserUnit" in the PDF. The card shows the real size first. It shows the nominal size and the UserUnit after it. The exported PDFs keep the UserUnit. CorelDRAW imports these PDFs at the real size.

## 3. Select artboards

Each card has a check box. The tool selects all artboards except the "Large raster" artboards.

The tool also selects the artboards with the "Pixel image as vectors", "Traced image" and "Many objects" badges. Often this artwork is the only version of the logo that you have. Read the note before you export it.

- To select all artboards, click **All**.
- To clear all check boxes, click **None**.
- To go back to the default selection, click **Recommended**.

## 4. Export artboards

Use the **Export** area at the bottom of the page.

- To get one PDF with all selected artboards, click **Download PDF**. The file name is, for example, `Client file (artboards 1-8).pdf`.
- To get one PDF for each selected artboard, click **Download PDF per artboard**. The file names are, for example, `Client file - artboard 3.pdf`. If the browser asks to allow more than one download, click **Allow**.
- To get one .zip file that has one PDF for each artboard, click **Download ZIP**.

The tool removes Illustrator private data during export. To see the details, click **How the export cleans the file**. You cannot edit the exported file as a native .ai file in Illustrator. All artwork stays in the file.

Open the exported PDF in CorelDRAW with **File > Import** or **File > Open**.

## 5. Select elements

You can take one logo or one part of an artboard out of the file.

1. Click the preview of an artboard. The viewer opens.
2. Move the pointer over the artwork. A blue box shows the element under the pointer.
3. Click to select the element. An orange box shows the selection.

Use these actions to change the selection:

| Action | Result |
| --- | --- |
| Click | Selects the top-level element under the pointer. |
| Shift + click | Adds the element to the selection, or removes it. |
| Alt + click | Selects the element one level deeper in the group. Click again with Alt to go deeper. |
| Drag on the artboard | Selects all elements that are fully inside the rectangle. |
| Shift + drag | Adds the elements in the rectangle to the selection. |
| **Parent** button | Selects the group that contains the selected element. |
| **Deeper** button | Selects the parts of the selected group. |
| **Clear** button | Clears the selection. |

The **Selection** panel shows each selected element, its type and its real size in millimetres. The symbol "≈" shows that the size is approximate. Text and gradients have approximate sizes.

On some Linux desktops, Alt + drag moves the window. If Alt + click does not work, use the **Deeper** button.

## 6. Download a selection

Use the buttons in the **Download selection** area.

- **Download vector PDF**: The tool makes a PDF with one page. The page has the size of the selection plus a 2 mm margin. The PDF has only the selected elements. Use this file in CorelDRAW.
- **Download PNG**: Select the resolution (72, 150, 300 or 600 dpi). Then click **Download PNG**. The background is transparent. The panel shows the size in pixels before you click.
- **Download original image**: This button is available when the selection has exactly one raster image. The tool saves the image at its full resolution. The tool keeps the transparency and the ICC colour profile. A JPEG image is saved as the original JPEG file.

## 7. Viewer controls and keyboard shortcuts

| Key or control | Action |
| --- | --- |
| Mouse wheel, or pinch on a touchpad or touch screen | Zoom at the pointer |
| **+** or **=** | Zoom in |
| **-** | Zoom out |
| **0** or **Fit to window** | Fit the artboard to the window |
| Space + drag, or middle button + drag | Pan |
| **H** or **Hand tool** | Use the hand tool (drag to pan) |
| **V** or **Select tool** | Use the select tool |
| **J** or Right arrow | Next artboard |
| **K** or Left arrow | Previous artboard |
| Ctrl + A | Select all top-level elements |
| **Esc** or **Close** | Close the viewer |

When you zoom, the view can be soft for a short time. Then the tool draws a sharp image of the visible area.

## 8. When a file fails

### The .ai file has no PDF compatibility

The tool shows this message: "This .ai file has no PDF compatibility. Ask the client to save it again with 'Create PDF Compatible File' selected."

Do these steps:

1. Ask the client to open the file in Illustrator.
2. Ask the client to select **File > Save As**, then **Adobe Illustrator (ai)**.
3. Ask the client to select **Create PDF Compatible File** in the options.
4. Ask the client to send the new file.

### Live fonts

The tool shows the "Live fonts" badge and a yellow "Live fonts" note. CorelDRAW uses a different font if the font is not installed on your computer. The text can then look wrong.

Do one of these steps:

- Ask the client for a version with the text converted to outlines. In Illustrator, the command is **Type > Create Outlines**.
- Convert the text to outlines yourself in Illustrator or Inkscape.
- Install the font on your computer before you import the file into CorelDRAW. Make sure that the font licence lets you do this.

This version of the tool cannot convert text to outlines.

### Large raster artboards

The "Large raster: not selected" badge and the red "Large raster images" note show that the artboard has raster images larger than 50 MP in total. This is usually an overview or presentation board. These images make CorelDRAW very slow, or CorelDRAW cannot open the file.

Do these steps:

1. Keep the artboard unselected.
2. Export the other artboards.
3. If you need the content of the large board, ask the client which items you need. Then select those items in the viewer and download them.

The preview does not show images larger than 50 MP. The viewer shows the vector parts only.

### Pixel image as vectors

The "Pixel image as vectors" badge and the red note show that the artwork is a raster image that a program converted into vector rectangles. The file looks like vector artwork, but it has the quality of the original pixel image. Each pixel is a hard-edged square. CorelDRAW cannot make the edges smooth when you scale the artwork.

The note gives these numbers:

- The number of rectangles.
- The approximate size of the source image in pixels. The tool divides the size of the artwork by the size of one pixel.
- The approximate resolution in dpi at the real size of the artboard. The tool includes the UserUnit.

For example: "Artboard 1 is a pixel image converted into 247,535 small rectangles. The source image was about 1,288 × 762 px. At the real size, this is about 72 dpi."

Do these steps:

1. For full-colour print, ask the client for the original image (PNG, JPEG, TIFF or PSD). The image must have 150 dpi or more at the print size.
2. For vector work (cutting, engraving, embroidery or screen printing), ask the client for the vector source file. If the client does not have it, redraw the artwork.
3. If you must use the file, export this artboard as a separate PDF. CorelDRAW is slow with this many objects.

### Traced image

The "Traced image" badge and the yellow note show that the artwork looks like a raster image that was traced, for example with **Image Trace** in Illustrator. The tool found many filled shapes in many flat colours, with curves. It found no strokes, no text and no gradients.

The note gives the number of shapes and colours. For example: "Artboard 1 looks like a traced image. It has 1,823 filled shapes in 30 flat colours."

A traced image has these problems:

- Smooth gradients become flat bands of colour.
- Small details, thin lines and small text become rough or disappear.
- The edges of the shapes are not as clean as drawn artwork.

Do these steps:

1. Open the artboard in the viewer. Zoom in to 100% or more.
2. Compare the artwork with the original image, if you have it.
3. If the quality is not good enough, ask the client for the original image or the vector source file.

This check is an estimate. Some drawn artwork with many colours can get this badge. Some traced artwork with strokes or few colours does not get it.

### Very many objects

The "Many objects" badge and the yellow "Very many objects" note show that the artboard has more than 50,000 drawing operations or filled paths. CorelDRAW can be very slow with this artwork, or it can stop.

Do these steps:

1. Export this artboard as a separate PDF. Click **Download PDF per artboard**, or select only this artboard.
2. In CorelDRAW, save your work frequently.
3. If the artboard also has the "Pixel image as vectors" or "Traced image" badge, read that section first.

### Raster client logos

A logo is sometimes a raster image, not vector artwork. The card shows the image in the list of raster images.

Do these steps:

1. Open the artboard in the viewer.
2. Select the logo.
3. Look at the **Selection** panel. If the list shows "Image", the logo is a raster image.
4. To get the image at full resolution, click **Download original image**.
5. If you need a vector logo, ask the client for the vector source file (.ai, .eps, .svg or .pdf).

A raster logo that is smaller than about 300 dpi at the print size can print soft. Divide the pixel width by the print width in inches to get the dpi.

### Other errors

- "This PDF has a password": Ask the client for a copy without a password.
- "This file is not a PDF": Make sure that the file is a PDF or an .ai file.
- "Cannot read this file": The file is possibly damaged. Ask the client to save the file again.
