import fs from 'node:fs';
import path from 'node:path';

import { ValidationError } from './errors';
import { logStep } from './logging';
import type { SubtitleGenerationOptions, SubtitleItem } from './types';

export const DEFAULT_MAX_ITEMS = 100;

export function parseSubtitleItems(jsonText: string, options: SubtitleGenerationOptions = {}): SubtitleItem[] {
  logStep(options, 'parseSubtitleItems: parsing JSON text');
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new ValidationError(`Invalid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError('Subtitle JSON must be an array of items.');
  }

  if (parsed.length > maxItems) {
    throw new ValidationError(`Subtitle JSON contains ${parsed.length} items; the current limit is ${maxItems} items.`);
  }

  logStep(options, `parseSubtitleItems: validating ${parsed.length} subtitle items`);
  return parsed.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(`Item ${index + 1} must be an object with a non-empty text field.`);
    }

    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new ValidationError(`Item ${index + 1} must include a non-empty text string.`);
    }

    return { text };
  });
}

export function parseSubtitleTextItems(text: string, options: SubtitleGenerationOptions = {}): SubtitleItem[] {
  logStep(options, 'parseSubtitleTextItems: parsing plain text lines');
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const items = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line }));

  if (items.length > maxItems) {
    throw new ValidationError(`Subtitle text file contains ${items.length} items; the current limit is ${maxItems} items.`);
  }

  if (items.length === 0) {
    throw new ValidationError('Subtitle text file must contain at least one non-empty line.');
  }

  logStep(options, `parseSubtitleTextItems: validated ${items.length} subtitle items`);
  return items;
}

export function parseSubtitleJsonFile(jsonPath: string, options: SubtitleGenerationOptions = {}): SubtitleItem[] {
  logStep(options, `parseSubtitleJsonFile: reading ${jsonPath}`);
  const extension = path.extname(jsonPath).toLowerCase();
  const fileText = fs.readFileSync(jsonPath, 'utf8');

  if (extension === '.json') {
    return parseSubtitleItems(fileText, options);
  }

  if (extension === '.txt') {
    return parseSubtitleTextItems(fileText, options);
  }

  throw new ValidationError(`Unsupported subtitle script file type: ${extension || '(no extension)'}. Use .json or .txt.`);
}
