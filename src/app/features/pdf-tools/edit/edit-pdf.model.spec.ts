import { describe, expect, it } from 'vitest';
import { hexToRgb01, isBoxLike, type Ann } from './edit-pdf.model';

describe('edit-pdf.model', () => {
  it('converts hex colours to 0–1 rgb', () => {
    expect(hexToRgb01('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb01('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    const red = hexToRgb01('#ff0000');
    expect(red.r).toBe(1);
    expect(red.g).toBe(0);
    expect(red.b).toBe(0);
  });

  it('tolerates a missing leading hash and bad input', () => {
    expect(hexToRgb01('5b4ee6').r).toBeCloseTo(0x5b / 255, 5);
    expect(hexToRgb01('not-a-colour')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('recognises box-like annotations (resizable) vs line/pen', () => {
    const text: Ann = { id: '1', type: 'text', page: 1, x: 0, y: 0, w: 10, h: 10, text: 'hi', fontSize: 16, color: '#000', bold: false, italic: false };
    const rect: Ann = { id: '2', type: 'rect', page: 1, x: 0, y: 0, w: 10, h: 10, color: '#000', opacity: 1, strokeWidth: 2 };
    const line: Ann = { id: '3', type: 'line', page: 1, x1: 0, y1: 0, x2: 5, y2: 5, color: '#000', width: 2 };
    const pen: Ann = { id: '4', type: 'pen', page: 1, points: [{ x: 0, y: 0 }], color: '#000', width: 2 };

    expect(isBoxLike(text)).toBe(true);
    expect(isBoxLike(rect)).toBe(true);
    expect(isBoxLike(line)).toBe(false);
    expect(isBoxLike(pen)).toBe(false);
  });
});
