'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { convert } = require('../src/convert');
const { fixture, BASE_URL } = require('./helpers');

const convertFixture = (name, options = {}) =>
  convert(fixture(name), { baseUrl: BASE_URL, ...options });

test('numbered steps become an ordered list, never headings', () => {
  const { markdown } = convertFixture('basic.html');

  assert.match(markdown, /^1\.\s+Go to /m);
  assert.match(markdown, /^4\.\s+Check desktop, tablet and mobile\./m);
  assert.doesNotMatch(markdown, /^#\s+Go to/m);
});

test('emphasis is bold, not italic', () => {
  const { markdown } = convertFixture('basic.html');

  assert.match(markdown, /\*\*Issue\*\*/);
  assert.match(markdown, /\*\*Testing Steps\*\*/);
  assert.doesNotMatch(markdown, /(^|[^*])\*Issue\*([^*]|$)/);
});

test('links keep their label and destination', () => {
  const { markdown } = convertFixture('basic.html');

  assert.match(markdown, /\[the signup page\]\(https:\/\/staging\.example\.com\/signup\?utm=1\*abc\*def_ghi\)/);
});

test('a smart link whose label is its own URL becomes an autolink', () => {
  const { markdown } = convertFixture('basic.html');

  assert.match(markdown, /<https:\/\/www\.example\.com\/design\/spec\?node-id=42&m=dev>/);
  assert.doesNotMatch(markdown, /smart-link/);
});

test('images become attachment links and are collected', () => {
  const { markdown, images } = convertFixture('basic.html');

  assert.match(markdown, /\[📎 signup-page\.png\]\(https:\/\/your-org\.atlassian\.net\/rest\/api\/3\/attachment\/content\/10021\)/);
  assert.deepEqual(images, [
    {
      name: 'signup-page.png',
      url: 'https://your-org.atlassian.net/rest/api/3/attachment/content/10021',
    },
  ]);
});

test('images can be stripped', () => {
  const { markdown, images } = convertFixture('basic.html', { attachmentsMode: 'off' });

  assert.doesNotMatch(markdown, /📎/);
  assert.equal(images.length, 1, 'the attachment is still recorded so it can be listed elsewhere');
});

test('no raw Jira or HTML syntax survives', () => {
  const { markdown } = convertFixture('basic.html');

  assert.doesNotMatch(markdown, /<(p|b|ol|li|span|img)\b/i);
  assert.doesNotMatch(markdown, /image-wrap|border: 0px/);
  assert.doesNotMatch(markdown, /\|smart-link|!\w+\.png\|/);
});

test('tables, code blocks, panels and lozenges convert', () => {
  const { markdown } = convertFixture('rich.html');

  assert.match(markdown, /^## Background$/m);
  assert.match(markdown, /\| Environment \| Rows \| Owner \|/);
  assert.match(markdown, /^> \[!WARNING\]$/m);
  assert.match(markdown, /> Do not run this against production/);
  assert.match(markdown, /```javascript\nconst rows = source\.filter\(\(row\) => row\.status\);/);
  assert.match(markdown, /`IN PROGRESS`/);
});

test('mentions are bold text so they cannot ping a GitHub account', () => {
  const { markdown } = convertFixture('rich.html');

  assert.match(markdown, /\*\*@Dana Fields\*\*/);
  assert.doesNotMatch(markdown, /(^|[^*@])@Dana/);
});

test('nested lists and emoticons survive', () => {
  const { markdown } = convertFixture('rich.html');

  assert.match(markdown, /^-\s+Validate the CSV header$/m);
  assert.match(markdown, /^\s+-\s+Reject unknown columns$/m);
  assert.match(markdown, /Nice work :\)/);
});

test('non breaking spaces are normalised', () => {
  const { markdown } = convertFixture('rich.html');

  assert.doesNotMatch(markdown, /\u00a0/);
  assert.match(markdown, /rows whose `status` column is empty/);
});

test('a destination holding parentheses is wrapped in angle brackets', () => {
  const { markdown } = convertFixture('edge.html');

  assert.match(markdown, /\[the setup page \(v2\)\]\(<https:\/\/docs\.example\.com\/guide_\(v2\)\/setup>\)/);
});

test('relative links are resolved against the Jira base URL', () => {
  const { markdown } = convertFixture('edge.html');

  assert.match(markdown, /\[Runbook\]\(https:\/\/your-org\.atlassian\.net\/wiki\/spaces\/TEAM\/pages\/12345\/Runbook\)/);
});

test('an image inside a link produces a single link', () => {
  const { markdown, images } = convertFixture('edge.html');

  assert.match(markdown, /\[📎 report\.pdf\]\(https:\/\/assets\.example\.com\/report\.pdf\)/);
  assert.doesNotMatch(markdown, /\]\(https:\/\/assets\.example\.com\/report-thumb\.png\)/);
  assert.equal(images[0].url, 'https://assets.example.com/report.pdf');
});

test('empty paragraphs and stray whitespace are removed', () => {
  const { markdown } = convertFixture('edge.html');

  assert.doesNotMatch(markdown, /\n{3,}/);
  assert.doesNotMatch(markdown, /[ \t]+$/m);
  assert.equal(markdown, markdown.trim());
});

test('line breaks and quotes are preserved', () => {
  const { markdown } = convertFixture('edge.html');

  assert.match(markdown, /First line\nsecond line/);
  assert.match(markdown, /^> Quoted note from the reporter\.$/m);
});

test('an empty description converts to an empty string', () => {
  assert.deepEqual(convert('', { baseUrl: BASE_URL }), { markdown: '', images: [] });
  assert.deepEqual(convert(null, { baseUrl: BASE_URL }), { markdown: '', images: [] });
});
