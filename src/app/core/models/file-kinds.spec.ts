import { describe, it, expect } from 'vitest';
import { detectKind, extensionOf, kindMeta } from './file-kinds';

describe('extensionOf', () => {
  it('returns the lowercased extension', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf');
    expect(extensionOf('a.b.csv')).toBe('csv');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('detectKind', () => {
  it('maps common extensions to kinds', () => {
    expect(detectKind('a.pdf')).toBe('pdf');
    expect(detectKind('a.docx')).toBe('word');
    expect(detectKind('a.xlsx')).toBe('spreadsheet');
    expect(detectKind('a.csv')).toBe('csv');
    expect(detectKind('a.png')).toBe('image');
    expect(detectKind('a.svg')).toBe('image');
    expect(detectKind('a.md')).toBe('markdown');
    expect(detectKind('a.json')).toBe('json');
    expect(detectKind('a.zip')).toBe('archive');
  });
  it('falls back to MIME when extension is unknown', () => {
    expect(detectKind('mystery', 'application/pdf')).toBe('pdf');
    expect(detectKind('mystery', 'image/png')).toBe('image');
    expect(detectKind('mystery', 'text/plain')).toBe('text');
  });
  it('returns other for unknown input', () => {
    expect(detectKind('mystery')).toBe('other');
  });
});

describe('kindMeta', () => {
  it('provides a label, icon and viewer flag for every kind', () => {
    const pdf = kindMeta('pdf');
    expect(pdf.label).toBe('PDF');
    expect(pdf.hasViewer).toBe(true);
    expect(kindMeta('archive').hasViewer).toBe(false);
  });
});
