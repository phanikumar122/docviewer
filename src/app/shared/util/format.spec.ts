import { describe, it, expect } from 'vitest';
import { formatBytes, relativeTime, baseName, withSuffix, changeExt, uid } from './format';

describe('formatBytes', () => {
  it('formats zero and negatives as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
  it('formats bytes, KB, MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('reports just now for recent times', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
  });
  it('reports minutes and hours', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
  it('reports days', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('filename helpers', () => {
  it('baseName strips the extension', () => {
    expect(baseName('report.pdf')).toBe('report');
    expect(baseName('archive.tar.gz')).toBe('archive.tar');
    expect(baseName('noext')).toBe('noext');
  });
  it('withSuffix inserts before the extension', () => {
    expect(withSuffix('report.pdf', '-merged')).toBe('report-merged.pdf');
    expect(withSuffix('noext', ' copy')).toBe('noext copy');
  });
  it('changeExt swaps the extension', () => {
    expect(changeExt('report.pdf', 'txt')).toBe('report.txt');
    expect(changeExt('a.b.c', 'md')).toBe('a.b.md');
  });
});

describe('uid', () => {
  it('produces unique prefixed ids', () => {
    const a = uid('file');
    const b = uid('file');
    expect(a).not.toBe(b);
    expect(a.startsWith('file_')).toBe(true);
  });
});
