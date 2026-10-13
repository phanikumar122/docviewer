import * as pdfjsLib from 'pdfjs-dist';

let configured = false;

/**
 * Returns the pdf.js library with its worker configured once. The worker file is
 * copied to the app root by the build (see angular.json assets), so everything
 * runs locally with no CDN. If the worker fails to load, pdf.js falls back to a
 * main-thread "fake worker", so rendering still works.
 */
export function getPdfjs(): typeof pdfjsLib {
  if (!configured) {
    const base = typeof document !== 'undefined' ? document.baseURI : '/';
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
    configured = true;
  }
  return pdfjsLib;
}
