'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compose } = require('../src/compose');
const { fixture, issue, BASE_URL } = require('./helpers');

const build = (options = {}) =>
  compose(
    issue({
      descriptionHtml: fixture('basic.html'),
      attachments: [
        {
          name: 'signup-page.png',
          url: `${BASE_URL}/rest/api/3/attachment/content/10021`,
          size: 40960,
        },
      ],
    }),
    {
      baseUrl: BASE_URL,
      criteriaHeadings: ['acceptance criteria', 'testing steps'],
      ...options,
    },
  );

test('the default body links the issue and carries the description', () => {
  const { markdown } = build();

  assert.match(markdown, /^## \[ACME-42\]\(https:\/\/your-org\.atlassian\.net\/browse\/ACME-42\) Divider ignores the theme accent colour$/m);
  assert.match(markdown, /\*\*Issue\*\*/);
});

test('testing steps are lifted into their own section', () => {
  const { markdown } = build();
  const criteriaIndex = markdown.indexOf('### ✅ Testing and acceptance criteria');

  assert.ok(criteriaIndex > 0);
  assert.ok(markdown.indexOf('1.  Go to') > criteriaIndex, 'the steps follow their heading');
  assert.ok(markdown.indexOf('**Issue**') < criteriaIndex, 'the description stays above');
});

test('lifting the criteria out can be switched off', () => {
  const { markdown } = build({ criteriaSection: false });

  assert.doesNotMatch(markdown, /Testing and acceptance criteria/);
  assert.match(markdown, /\*\*Testing Steps\*\*/);
});

test('the attachments section lists the file with its size', () => {
  const { markdown } = build();

  assert.match(markdown, /<summary>📎 Attachments \(1\)<\/summary>/);
  assert.match(markdown, /\[signup-page\.png\]\(https:\/\/your-org\.atlassian\.net\/rest\/api\/3\/attachment\/content\/10021\) \| 40 KB/);
});

test('a long description is collapsed but a short one is not', () => {
  assert.doesNotMatch(build({ collapseOver: 5000 }).markdown, /<summary>📋/);
  assert.match(build({ collapseOver: 50 }).markdown, /<summary>📋 Jira description<\/summary>/);
});

test('the metadata table and checklist are opt in', () => {
  const plain = build();

  assert.doesNotMatch(plain.markdown, /\| Type \|/);
  assert.doesNotMatch(plain.markdown, /- \[ \]/);

  const extended = build({ metadataTable: true, checklist: 'Tests pass\nDocs updated' });

  assert.match(extended.markdown, /\| Type \| Status \| Priority \| Assignee \|/);
  assert.match(extended.markdown, /- \[ \] Tests pass/);
});

test('a custom template controls the whole layout', () => {
  const { markdown } = build({ template: '{{summary}} :: {{url}}' });

  assert.equal(markdown, 'Divider ignores the theme accent colour :: https://your-org.atlassian.net/browse/ACME-42');
});

test('an issue with no description still produces a usable body', () => {
  const { markdown } = compose(issue({ descriptionHtml: '' }), { baseUrl: BASE_URL });

  assert.match(markdown, /_This issue has no description\._/);
  assert.match(markdown, /ACME-42/);
});

test('nothing that GitHub renders as a giant heading survives', () => {
  const { markdown } = build();

  const headings = markdown.match(/^#{1,2}\s+.*/gm) || [];

  assert.equal(headings.length, 1, 'only the title is a heading');
});
