/** Scale the emulator canvas into the stage without cropping. SDL may rewrite the style. */
export function bindLetterbox(stage: HTMLElement, canvas: HTMLCanvasElement, signal: AbortSignal): () => void {
  let lock = false;

  const fit = () => {
    if (lock || signal.aborted) return;
    const rect = stage.getBoundingClientRect();
    const bitmapWidth = canvas.width;
    const bitmapHeight = canvas.height;
    // The blank canvas is 300×150. Fitting that first locks the emulator into a 2:1 window.
    if (bitmapWidth === 300 && bitmapHeight === 150) return;
    if (rect.width < 2 || rect.height < 2 || bitmapWidth < 2 || bitmapHeight < 2) return;
    const scale = Math.min(rect.width / bitmapWidth, rect.height / bitmapHeight);
    const width = Math.max(1, Math.floor(bitmapWidth * scale));
    const height = Math.max(1, Math.floor(bitmapHeight * scale));
    const widthValue = `${width}px`;
    const heightValue = `${height}px`;
    if (canvas.style.getPropertyValue('width') === widthValue && canvas.style.getPropertyValue('height') === heightValue) return;
    lock = true;
    canvas.style.setProperty('width', widthValue, 'important');
    canvas.style.setProperty('height', heightValue, 'important');
    canvas.style.setProperty('max-width', '100%', 'important');
    canvas.style.setProperty('max-height', '100%', 'important');
    lock = false;
  };

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(stage);
  const mutationObserver = new MutationObserver(fit);
  mutationObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
  window.addEventListener('resize', fit, { signal });
  signal.addEventListener('abort', () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  });
  fit();
  return fit;
}
