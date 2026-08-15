'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchIssue, extractIssue, normaliseBaseUrl, JiraError } = require('../src/jira');
const { detectIssueKey, readInputs, toBoolean } = require('../src/inputs');

const CREDENTIALS = {
  baseUrl: 'https://your-org.atlassian.net',
  email: 'bot@example.com',
  token: 'token',
  issueKey: 'ACME-42',
};

/**
 * Builds a fetch stub that records the URLs it was called with.
 *
 * @param {Array<{ok: boolean, status: number, body?: object}>} responses Responses in order.
 * @returns {Function} Fetch stub with a `calls` array.
 */
function stubFetch(responses) {
  const calls = [];
  const stub = async (url) => {
    calls.push(url);
    const next = responses[calls.length - 1] || responses[responses.length - 1];

    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body || {},
    };
  };

  stub.calls = calls;

  return stub;
}

test('a base URL is normalised', () => {
  assert.equal(normaliseBaseUrl('https://your-org.atlassian.net/'), 'https://your-org.atlassian.net');
  assert.equal(normaliseBaseUrl('your-org.atlassian.net'), 'https://your-org.atlassian.net');
  assert.throws(() => normaliseBaseUrl('  '), /jira-base-url is empty/);
});

test('the issue is requested from API v3 with rendered fields', async () => {
  const fetchImpl = stubFetch([{ ok: true, status: 200, body: { key: 'ACME-42' } }]);
  const { apiVersion } = await fetchIssue({ ...CREDENTIALS, fetchImpl });

  assert.equal(apiVersion, '3');
  assert.match(fetchImpl.calls[0], /\/rest\/api\/3\/issue\/ACME-42\?expand=renderedFields/);
});

test('a 404 falls back to API v2 for Jira Data Center', async () => {
  const fetchImpl = stubFetch([
    { ok: false, status: 404 },
    { ok: true, status: 200, body: { key: 'ACME-42' } },
  ]);
  const { apiVersion } = await fetchIssue({ ...CREDENTIALS, fetchImpl });

  assert.equal(apiVersion, '2');
  assert.equal(fetchImpl.calls.length, 2);
});

test('an authentication failure is not retried and explains itself', async () => {
  const fetchImpl = stubFetch([{ ok: false, status: 401 }]);

  await assert.rejects(() => fetchIssue({ ...CREDENTIALS, fetchImpl }), (error) => {
    assert.ok(error instanceof JiraError);
    assert.equal(error.status, 401);
    assert.match(error.message, /jira-email and jira-token/);
    return true;
  });

  assert.equal(fetchImpl.calls.length, 1);
});

test('issue fields are flattened, including attachments and parent', () => {
  const issue = extractIssue(
    {
      key: 'ACME-42',
      fields: {
        summary: 'Fix the divider',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        priority: { name: 'High' },
        assignee: { displayName: 'Dana Fields' },
        parent: { key: 'ACME-1', fields: { summary: 'Theme work' } },
        labels: ['frontend'],
        fixVersions: [{ name: '2.4.0' }],
        attachment: [
          { filename: 'shot.png', content: 'https://jira.example.com/a/1', size: 1024, mimeType: 'image/png' },
        ],
      },
      renderedFields: { description: '<p>Hello</p>' },
    },
    'https://your-org.atlassian.net',
  );

  assert.equal(issue.url, 'https://your-org.atlassian.net/browse/ACME-42');
  assert.equal(issue.descriptionHtml, '<p>Hello</p>');
  assert.equal(issue.parent.url, 'https://your-org.atlassian.net/browse/ACME-1');
  assert.deepEqual(issue.fixVersions, ['2.4.0']);
  assert.equal(issue.attachments[0].name, 'shot.png');
});

test('missing optional fields do not throw', () => {
  const issue = extractIssue({ key: 'ACME-9', fields: {} }, 'https://your-org.atlassian.net');

  assert.equal(issue.summary, '');
  assert.equal(issue.parent, null);
  assert.deepEqual(issue.attachments, []);
});

test('the issue key is detected from the branch first, then the title', () => {
  const pattern = '([A-Za-z][A-Za-z0-9]+-\\d+)';

  assert.equal(detectIssueKey(pattern, ['feature/acme-42', 'ACME-99: something']), 'ACME-42');
  assert.equal(detectIssueKey(pattern, [undefined, 'ACME-99: something']), 'ACME-99');
  assert.equal(detectIssueKey(pattern, ['release-branch']), '');
  assert.throws(() => detectIssueKey('([', ['x']), /not a valid regular expression/);
});

test('boolean inputs accept the spellings people write', () => {
  assert.equal(toBoolean('true', false), true);
  assert.equal(toBoolean('YES', false), true);
  assert.equal(toBoolean('off', true), false);
  assert.equal(toBoolean('', true), true);
  assert.equal(toBoolean('maybe', false), false);
});

test('invalid enum inputs fail early with a readable message', () => {
  const inputs = {
    'jira-base-url': 'https://your-org.atlassian.net',
    attachments: 'sometimes',
  };

  assert.throws(() => readInputs((name) => inputs[name] || ''), /attachments must be one of/);

  inputs.attachments = 'details';
  inputs.mode = 'merge';

  assert.throws(() => readInputs((name) => inputs[name] || ''), /mode must be one of/);
});
