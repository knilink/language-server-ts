import { describe, it, expect } from 'vitest';
import {
  hasLanguageMarker,
  comment,
  commentBlockAsSingles,
  getLanguageMarker,
  getPathMarker,
  newLineEnded,
} from './languageMarker'; // Update this with the actual path to your file

describe('commentFunctions', () => {
  describe('hasLanguageMarker', () => {
    it('should return true for HTML DOCTYPE', () => {
      const doc = { languageId: 'html', source: '<!DOCTYPE html>', uri: 'file:///doc.html' };
      expect(hasLanguageMarker(doc)).toBe(true);
    });

    it('should return true for shebang lines', () => {
      const doc = { languageId: 'python', source: '#!/usr/bin/env python3', uri: 'file:///doc.py' };
      expect(hasLanguageMarker(doc)).toBe(true);
    });

    it('should return false for plain text', () => {
      const doc = { languageId: 'plaintext', source: 'some text', uri: 'file:///doc.txt' };
      expect(hasLanguageMarker(doc)).toBe(false);
    });
  });

  describe('comment', () => {
    it('should comment a line of code in JavaScript', () => {
      const result = comment('This is a comment', 'javascript');
      expect(result).toBe('// This is a comment');
    });

    it('should comment a block of code in HTML', () => {
      const result = comment('This is an HTML comment', 'html');
      expect(result).toBe('<!-- This is an HTML comment -->');
    });
  });

  describe('commentBlockAsSingles', () => {
    it('should comment each line of a block in JavaScript', () => {
      const result = commentBlockAsSingles('line1\nline2', 'javascript');
      expect(result).toBe('// line1\n// line2');
    });
  });

  describe('getLanguageMarker', () => {
    it('should return the correct shebang line for Python', () => {
      const doc = { languageId: 'python', source: '', uri: 'file://doc.py' };
      expect(getLanguageMarker(doc)).toBe('#!/usr/bin/env python3');
    });

    it('should not add a marker for PHP', () => {
      const doc = { languageId: 'php', source: '<?', uri: 'file://doc.php' };
      expect(getLanguageMarker(doc)).toBeUndefined();
    });
  });

  describe('getPathMarker', () => {
    it('should return the correct path marker when relativePath is present', () => {
      const doc = { languageId: 'javascript', source: '', relativePath: '/path/to/file', uri: 'file://doc.js' };
      expect(getPathMarker(doc)).toBe('Path: /path/to/file');
    });

    it('should return undefined when relativePath is not present', () => {
      const doc = { languageId: 'javascript', source: '', uri: 'file://doc.js' };
      expect(getPathMarker(doc)).toBeUndefined();
    });
  });

  describe('newLineEnded', () => {
    it('should add a newline if not present', () => {
      const result = newLineEnded('This is a line');
      expect(result).toBe('This is a line\n');
    });

    it('should keep the content as-is if already ending with a newline', () => {
      const result = newLineEnded('This is a line\n');
      expect(result).toBe('This is a line\n');
    });
  });
});
