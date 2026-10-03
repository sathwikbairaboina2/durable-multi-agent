import type { SlackMessage } from '../src/core/slack-message.js';

const WIDTH = 64; // total width including the borders
const INNER = WIDTH - 4; // text width between "│ " and " │"

const strip = (s: string): string => s.replace(/\*/g, '').replace(/<@([A-Z0-9]+)>/g, '@$1');

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > width) {
      if (line) out.push(line);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      line = '';
    } else if ((line ? line.length + 1 : 0) + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Draws a Slack approval message as a terminal box. */
export function renderCard(message: SlackMessage): string {
  const blocks = message.blocks as Array<any>;
  const rows: string[] = [];
  const row = (t = '') => rows.push(`│ ${t.padEnd(INNER)} │`);
  const rule = '─'.repeat(WIDTH - 2);

  const header = blocks.find((b) => b.type === 'header')?.text?.text ?? 'Approval';
  row(header);
  row();

  const fields: string[] = (blocks.find((b) => b.type === 'section' && b.fields)?.fields ?? []).map((f: any) => strip(f.text).replace('\n', ': '));
  for (const f of fields) row(f.slice(0, INNER));
  row();

  const sections = blocks.filter((b) => b.type === 'section' && b.text && !b.fields);
  const lineSections = sections.filter((b) => String(b.text.text).includes(' × '));
  for (const s of lineSections) {
    const [label, price = ''] = strip(String(s.text.text)).split(' — ');
    const left = label.slice(0, INNER - price.length - 2);
    row(`${left}${' '.repeat(Math.max(2, INNER - left.length - price.length))}${price}`);
  }
  const ctx = blocks.find((b) => b.type === 'context')?.elements?.[0]?.text;
  if (ctx) {
    row();
    for (const l of wrap(strip(String(ctx)), INNER)) row(l);
  }
  const just = sections.filter((b) => !lineSections.includes(b)).at(-1)?.text?.text;
  if (just) {
    row();
    for (const l of wrap(strip(String(just)), 60)) row(l);
  }
  row();
  row('[ Approve ]  [ Reject ]');

  return [`┌${rule}┐`, ...rows, `└${rule}┘`].join('\n');
}
