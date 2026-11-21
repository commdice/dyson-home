import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain, parse, serialize } from '../src/store.js';

const tmpVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));

test('front matter round-trips, including awkward strings', () => {
  const m = { id: 'abc', title: 'He said: "hi" # not a comment', type: 'note', tags: ['a', 'b'], content: '---\nbody' };
  const back = parse(serialize(m));
  assert.equal(back.title, m.title);
  assert.deepEqual(back.tags, m.tags);
  assert.equal(back.content, '---\nbody');
});

test('remember, recall, get, update, forget', () => {
  const b = new Brain(tmpVault());
  const { memory } = b.remember({ content: 'Prefers dark mode in every editor', type: 'preference', tags: ['UI', '#editor'], importance: 5, source: 'test' });
  assert.equal(memory.title, 'Prefers dark mode in every editor');
  assert.deepEqual(memory.tags, ['ui', 'editor']);
  assert.ok(fs.existsSync(path.join(b.vault, memory.path)));

  b.remember({ content: 'The paint shop runs its POS on a Windows 11 box behind the counter', title: 'Shop POS setup', type: 'fact', tags: ['shop'] });

  assert.equal(b.search({ query: 'dark editor' }).results[0].id, memory.id);
  assert.equal(b.search({ query: 'counter POS' }).results[0].title, 'Shop POS setup');
  assert.equal(b.search({ query: 'windows', type: 'preference' }).results.length, 0);
  assert.equal(b.search({ query: 'zzz nothing', tags: ['shop'] }).results.length, 0);
  assert.equal(b.search({ tags: ['shop'] }).results.length, 1);
  // Stemming + prefix: "editors" / "edit" should still match "editor".
  assert.ok(b.search({ query: 'edit' }).results.length >= 1);

  const u = b.update(memory.id, { append: 'Including the terminal.', add_tags: ['terminal'], pinned: true });
  assert.match(u.content, /terminal\.$/);
  assert.deepEqual(u.tags, ['ui', 'editor', 'terminal']);
  assert.ok(b.context().pinned.some((m) => m.id === memory.id));

  const byTitle = b.get('shop pos setup');
  assert.equal(byTitle.type, 'fact');

  b.forget(memory.id);
  assert.equal(b.get(memory.id), null);
  assert.equal(fs.readdirSync(path.join(b.vault, '.trash')).length, 1);
});

test('duplicates are flagged and wiki links produce backlinks', () => {
  const b = new Brain(tmpVault());
  const a = b.remember({ content: 'Backups run nightly to the NAS', title: 'Backup schedule' }).memory;
  const dup = b.remember({ content: 'Backups go to the NAS every night', title: 'Backup schedule' });
  assert.ok(dup.possible_duplicates.some((m) => m.id === a.id));
  const c = b.remember({ content: 'Restore drill failed once, see [[Backup schedule]]', title: 'Restore drill' }).memory;
  assert.ok(b.get(a.id).backlinks.some((x) => x.id === c.id));
  assert.ok(b.related(c.id).related.some((x) => x.why === 'links to'));
});

test('hand edits and new files in the vault are picked up; deleted files drop out', () => {
  const vault = tmpVault();
  const b = new Brain(vault);
  const m = b.remember({ content: 'Original text', title: 'Editable' }).memory;
  const file = path.join(vault, m.path);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Original text', 'Edited in Obsidian with pineapple'));
  fs.writeFileSync(path.join(vault, 'by-hand.md'), serialize({ id: 'hand1', title: 'Written by hand', type: 'note', content: 'kiwi' }));
  b.sync(true);
  assert.equal(b.search({ query: 'pineapple' }).results[0].id, m.id);
  assert.equal(b.search({ query: 'kiwi' }).results[0].id, 'hand1');
  fs.rmSync(path.join(vault, 'by-hand.md'));
  b.sync(true);
  assert.equal(b.search({ query: 'kiwi' }).results.length, 0);
});

test('index can be deleted and rebuilt from files', () => {
  const vault = tmpVault();
  new Brain(vault).remember({ content: 'Survives index loss', title: 'Durable' });
  fs.rmSync(path.join(vault, '.brain'), { recursive: true });
  assert.equal(new Brain(vault).search({ query: 'durable' }).results.length, 1);
});

test('odd queries do not throw', () => {
  const b = new Brain(tmpVault());
  b.remember({ content: 'C++ and "quotes" AND OR NOT ( ) * :' });
  for (const q of ['"', 'AND', '(*)', 'c++', 'NEAR(', '  ', 'quotes:']) assert.doesNotThrow(() => b.search({ query: q }));
});
