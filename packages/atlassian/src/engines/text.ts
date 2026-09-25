import { readFileSync } from 'node:fs';

/** Read a planning artifact as text: UTF-8, without a BOM (Windows editors add one), LF line endings. */
export function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}
