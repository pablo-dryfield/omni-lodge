import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SourceMapGenerator } from 'source-map';

import {
  resetBrowserStackSymbolicationCachesForTests,
  symbolicateBrowserStack,
} from '../browserStackSymbolicationService.js';

describe('browser stack symbolication', () => {
  afterEach(() => resetBrowserStackSymbolicationCachesForTests());

  it('maps a production bundle location without exposing source content', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-symbolication-'));
    const buildRoot = path.join(root, 'build');
    const archiveRoot = path.join(root, 'archive');
    mkdirSync(path.join(buildRoot, 'static', 'js'), { recursive: true });
    const generator = new SourceMapGenerator({ file: 'main.abc123.js' });
    generator.addMapping({
      generated: { line: 1, column: 9 },
      original: { line: 42, column: 7 },
      source: 'webpack://ui/./src/pages/BookingsPage.tsx',
      name: 'saveBooking',
    });
    generator.setSourceContent('webpack://ui/./src/pages/BookingsPage.tsx', 'PRIVATE SOURCE');
    writeFileSync(
      path.join(buildRoot, 'static', 'js', 'main.abc123.js.map'),
      generator.toString(),
    );

    try {
      const result = symbolicateBrowserStack(
        'TypeError: failed\n    at save (https://omni-lodge.com/static/js/main.abc123.js:1:10)',
        'web-abc123',
        { buildRoot, archiveRoot },
      );
      expect(result).toContain('src/pages/BookingsPage.tsx:42:7');
      expect(result).toContain('(saveBooking)');
      expect(result).not.toContain('PRIVATE SOURCE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the original stack when a matching private map does not exist', () => {
    const stack = 'Error: failed\n at app (/static/js/main.none.js:1:2)';
    expect(symbolicateBrowserStack(stack, 'missing', {
      buildRoot: 'Z:/definitely/missing',
      archiveRoot: 'Z:/also/missing',
    })).toBe(stack);
  });

  it('prefers the exact archived release over the current build', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-symbolication-release-'));
    const buildRoot = path.join(root, 'build');
    const archiveRoot = path.join(root, 'archive');
    const filename = 'main.samehash.js.map';
    const writeMap = (destination: string, source: string) => {
      mkdirSync(path.dirname(destination), { recursive: true });
      const generator = new SourceMapGenerator({ file: 'main.samehash.js' });
      generator.addMapping({
        generated: { line: 1, column: 9 },
        original: { line: 20, column: 3 },
        source,
      });
      writeFileSync(destination, generator.toString());
    };
    writeMap(path.join(buildRoot, 'static', 'js', filename), 'webpack://ui/./src/Current.tsx');
    writeMap(
      path.join(archiveRoot, 'release-old', 'static', 'js', filename),
      'webpack://ui/./src/Archived.tsx',
    );

    try {
      const result = symbolicateBrowserStack(
        'Error: failed\n at app (/static/js/main.samehash.js:1:10)',
        'release-old',
        { buildRoot, archiveRoot },
      );
      expect(result).toContain('src/Archived.tsx:20:3');
      expect(result).not.toContain('src/Current.tsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refreshes a cached archive index after a miss', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-symbolication-refresh-'));
    const buildRoot = path.join(root, 'build');
    const archiveRoot = path.join(root, 'archive');
    mkdirSync(archiveRoot, { recursive: true });
    const stack = 'Error: failed\n at lazy (/static/js/lazy.newhash.js:1:10)';
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    try {
      expect(symbolicateBrowserStack(stack, null, { buildRoot, archiveRoot })).toBe(stack);
      const mapPath = path.join(archiveRoot, 'new-release', 'static', 'js', 'lazy.newhash.js.map');
      mkdirSync(path.dirname(mapPath), { recursive: true });
      const generator = new SourceMapGenerator({ file: 'lazy.newhash.js' });
      generator.addMapping({
        generated: { line: 1, column: 9 },
        original: { line: 77, column: 4 },
        source: 'webpack://ui/./src/LazyFeature.tsx',
      });
      writeFileSync(mapPath, generator.toString());
      clock.mockReturnValue(1_005_001);

      expect(symbolicateBrowserStack(stack, null, { buildRoot, archiveRoot }))
        .toContain('src/LazyFeature.tsx:77:4');
    } finally {
      clock.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
