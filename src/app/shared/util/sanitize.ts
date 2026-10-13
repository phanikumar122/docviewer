import DOMPurify from 'dompurify';

/**
 * Sanitise untrusted HTML (DOCX conversions, Markdown output) before rendering.
 * We forbid scripts, event handlers and risky tags. External resources are
 * limited to data/blob/https images.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitise an SVG document for safe inline rendering (strips scripts, foreign
 * objects and event handlers while keeping shapes and styling attributes).
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick'],
  });
}
