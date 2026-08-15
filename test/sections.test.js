'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitCriteria,
  buildAttachments,
  buildMetadata,
  buildChecklist,
  collapse,
  formatBytes,
} = require('../src/sections');

const HEADINGS = ['acceptance criteria', 'testing steps', 'qa steps'];

test('a bold pseudo heading starts the criteria section', () => {
  const markdown = ['**Issue**', '', 'Something is broken.', '', '**Testing Steps**', '', '1.  Open the page', '2.  Look at it'].join('\n');
  const { description, criteria } = splitCriteria(markdown, HEADINGS);

  assert.equal(criteria, '1.  Open the page\n2.  Look at it');
  assert.doesNotMatch(description, /Testing Steps/);
  assert.match(description, /Something is broken\./);
});

test('a real heading also starts the section, and the next heading ends it', () => {
  const markdown = ['## Acceptance Criteria', '', '- One', '- Two', '', '## Notes', '', 'Unrelated.'].join('\n');
  const { description, criteria } = splitCriteria(markdown, HEADINGS);

  assert.equal(criteria, '- One\n- Two');
  assert.match(description, /## Notes/);
  assert.match(description, /Unrelated\./);
});

test('the description is untouched when no heading matches', () => {
  const markdown = '**Background**\n\nNothing to lift out.';

  assert.deepEqual(splitCriteria(markdown, HEADINGS), { description: markdown, criteria: '' });
});

test('an empty section is left in place', () => {
  const markdown = '**Testing Steps**';

  assert.deepEqual(splitCriteria(markdown, HEADINGS), { description: markdown, criteria: '' });
});

test('attachments merge inline images with the issue attachment list', () => {
  const section = buildAttachments({
    images: [{ name: 'inline.png', url: 'https://jira.example.com/attachment/1' }],
    attachments: [
      { name: 'inline.png', url: 'https://jira.example.com/attachment/1', size: 2048 },
      { name: 'spec.pdf', url: 'https://jira.example.com/attachment/2', size: 1048576 },
    ],
    mode: 'details',
  });

  assert.match(section, /📎 Attachments \(2\)/);
  assert.match(section, /\| \[inline\.png\]\(https:\/\/jira\.example\.com\/attachment\/1\) \| 2 KB \|/);
  assert.match(section, /\| \[spec\.pdf\]\(https:\/\/jira\.example\.com\/attachment\/2\) \| 1 MB \|/);
  assert.equal(section.match(/inline\.png/g).length, 1, 'the same file is not listed twice');
});

test('the attachments section is skipped unless the mode asks for it', () => {
  const images = [{ name: 'a.png', url: 'https://jira.example.com/attachment/1' }];

  assert.equal(buildAttachments({ images, mode: 'inline' }), '');
  assert.equal(buildAttachments({ images, mode: 'off' }), '');
  assert.equal(buildAttachments({ images: [], attachments: [], mode: 'details' }), '');
});

test('the metadata table only holds the columns that have a value', () => {
  const table = buildMetadata({
    type: 'Bug',
    status: 'In Progress',
    priority: '',
    assignee: 'Dana Fields',
    parent: { key: 'ACME-1', url: 'https://jira.example.com/browse/ACME-1' },
    labels: ['frontend'],
    fixVersions: [],
  });

  assert.match(table, /\| Type \| Status \| Assignee \| Parent \| Labels \|/);
  assert.doesNotMatch(table, /Priority/);
  assert.equal(table.split('\n').length, 3);
});

test('collapsing only kicks in above the limit', () => {
  const short = 'Short description.';
  const long = 'x'.repeat(120);

  assert.equal(collapse(short, 100), short);
  assert.equal(collapse(long, 0), long);
  assert.match(collapse(long, 100), /^<details>\n<summary>📋 Jira description<\/summary>\n\n/);
  assert.match(collapse(long, 100), /\n<\/details>$/);
});

test('checklist items accept plain lines or Markdown', () => {
  assert.equal(buildChecklist('Tests pass\n- [ ] Docs updated'), '- [ ] Tests pass\n- [ ] Docs updated');
  assert.equal(buildChecklist(''), '');
});

test('sizes are readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(undefined), '');
});
