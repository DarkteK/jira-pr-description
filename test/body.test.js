'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { render, applyMode, truncate, START_MARKER, END_MARKER, MAX_BODY } = require('../src/body');

test('placeholders are filled and empty ones leave no gap', () => {
  const body = render('## {{key}} {{summary}}\n\n{{metadata}}\n\n{{description}}', {
    key: 'ACME-42',
    summary: 'Fix the divider',
    metadata: '',
    description: 'The divider is the wrong colour.',
  });

  assert.equal(body, '## ACME-42 Fix the divider\n\nThe divider is the wrong colour.');
});

test('an unknown placeholder renders as nothing', () => {
  assert.equal(render('a {{nope}} b', {}), 'a  b');
});

test('replace mode returns only the generated content', () => {
  const body = applyMode({ existing: 'Notes from the author.', generated: 'Jira content', mode: 'replace' });

  assert.equal(body, 'Jira content');
});

test('block mode keeps what the author wrote', () => {
  const body = applyMode({ existing: 'Notes from the author.', generated: 'Jira content', mode: 'block' });

  assert.equal(body, `${START_MARKER}\nJira content\n${END_MARKER}\n\nNotes from the author.`);
});

test('block mode replaces only the marked region on a second run', () => {
  const first = applyMode({ existing: 'Author notes.', generated: 'Old', mode: 'block' });
  const second = applyMode({ existing: first, generated: 'New', mode: 'block' });

  assert.match(second, /New/);
  assert.doesNotMatch(second, /Old/);
  assert.match(second, /Author notes\./);
  assert.equal(second.match(new RegExp(START_MARKER, 'g')).length, 1);
});

test('a body longer than the GitHub limit is cut on a line boundary and says so', () => {
  const long = Array.from({ length: 5000 }, (_, index) => `line ${index} ${'padding '.repeat(3)}`).join('\n');
  const body = applyMode({ existing: '', generated: long, mode: 'replace' });

  assert.ok(body.length < MAX_BODY);
  assert.match(body, /shortened because it exceeds the GitHub size limit/);
  assert.match(body, /^line 0 /m);
});

test('content within the limit is returned untouched', () => {
  assert.equal(truncate('short'), 'short');
});
