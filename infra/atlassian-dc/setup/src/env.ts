import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Minimal .env reader/writer that preserves comments, order, and unknown keys. */
export class EnvFile {
  private lines: string[];
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (!existsSync(path)) throw new Error(`${path} not found (run ./dc.ps1 init)`);
    this.lines = readFileSync(path, 'utf8').split(/\r?\n/);
  }

  get(name: string, fallback = ''): string {
    const line = this.lines.find((l) => l.match(new RegExp(`^\\s*${name}\\s*=`)));
    const value = line?.split('=').slice(1).join('=').trim();
    return value || fallback;
  }

  set(name: string, value: string): void {
    const i = this.lines.findIndex((l) => l.match(new RegExp(`^\\s*${name}\\s*=`)));
    if (i >= 0) this.lines[i] = `${name}=${value}`;
    else this.lines.splice(this.lines.at(-1) === '' ? -1 : this.lines.length, 0, `${name}=${value}`);
    writeFileSync(this.path, this.lines.join('\n'));
  }
}
