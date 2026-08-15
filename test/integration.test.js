'use strict';

/**
 * Runs the action the way a runner does: real process, real HTTP, mock Jira and mock GitHub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { fixture } = require('./helpers');

const ENTRY = path.join(__dirname, '..', 'src', 'index.js');

/**
 * Starts a server that answers as Jira on `/rest/...` and as GitHub on everything else.
 *
 * @param {object} options Server options.
 * @param {object} options.issue Issue payload to return.
 * @param {object} options.pullRequest Pull request payload for lookups.
 * @returns {Promise<{url: string, requests: object[], close: Function}>} Running server.
 */
async function startServer({ issue, pullRequest }) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader('content-type', 'application/json');

      if (request.url.startsWith('/rest/api/3/issue/')) {
        response.end(JSON.stringify(issue));
        return;
      }

      if (request.method === 'GET' && /\/pulls\?/.test(request.url)) {
        response.end(JSON.stringify([pullRequest]));
        return;
      }

      response.end(JSON.stringify({ ...pullRequest, ...(body ? JSON.parse(body) : {}) }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Runs the action with the given inputs and event payload.
 *
 * @param {object} options Run options.
 * @returns {Promise<{code: number, stdout: string, outputs: Record<string, string>, summary: string}>}
 *   What the action did.
 */
async function runAction({ inputs, payload, url, ref = 'refs/heads/acme-42' }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-pr-'));
  const eventFile = path.join(workspace, 'event.json');
  const outputFile = path.join(workspace, 'output.txt');
  const summaryFile = path.join(workspace, 'summary.md');

  fs.writeFileSync(eventFile, JSON.stringify(payload));
  fs.writeFileSync(outputFile, '');
  fs.writeFileSync(summaryFile, '');

  const env = {
    ...process.env,
    GITHUB_REPOSITORY: 'octo/demo',
    GITHUB_API_URL: url,
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_REF: ref,
    INPUT_ATTACHMENTS: 'details',
    // The runner keeps dashes in input names and only replaces spaces, which is what core reads.
    ...Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [`INPUT_${key.replace(/ /g, '_').toUpperCase()}`, String(value)]),
    ),
  };

  const result = await new Promise((resolve) => {
    execFile('node', [ENTRY], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code || 1 : 0, stdout: `${stdout}${stderr}` });
    });
  });

  const outputs = Object.fromEntries(
    [...fs.readFileSync(outputFile, 'utf8').matchAll(/^(.+?)<<ghadelimiter_[^\n]+\n([\s\S]*?)\nghadelimiter_[^\n]+$/gm)].map(
      (match) => [match[1], match[2]],
    ),
  );

  return { ...result, outputs, summary: fs.readFileSync(summaryFile, 'utf8') };
}

const ISSUE = {
  key: 'ACME-42',
  fields: {
    summary: 'Divider ignores the theme accent colour',
    status: { name: 'In Progress' },
    issuetype: { name: 'Bug' },
    assignee: { displayName: 'Dana Fields' },
    attachment: [],
  },
  renderedFields: { description: fixture('basic.html') },
};

const PULL_REQUEST = {
  number: 7,
  title: 'Fix the divider',
  body: 'Original body written by the author.',
  head: { ref: 'acme-42' },
};

test('it reads the issue and writes the pull request body', async (t) => {
  const server = await startServer({ issue: ISSUE, pullRequest: PULL_REQUEST });
  t.after(() => server.close());

  const run = await runAction({
    url: server.url,
    payload: { pull_request: PULL_REQUEST },
    inputs: {
      'github-token': 'token',
      'jira-base-url': server.url,
      'jira-email': 'bot@example.com',
      'jira-token': 'secret',
    },
  });

  assert.equal(run.code, 0, run.stdout);

  const update = server.requests.find((request) => request.method === 'PATCH');

  assert.ok(update, 'the pull request was updated');
  assert.match(update.url, /\/repos\/octo\/demo\/pulls\/7$/);

  const body = JSON.parse(update.body).body;

  assert.match(body, /^## \[ACME-42\]/m);
  assert.match(body, /^1\.\s+Go to \[the signup page\]/m);
  assert.doesNotMatch(body, /Original body/, 'replace mode overwrites the body');
  assert.equal(run.outputs['issue-key'], 'ACME-42');
  assert.equal(run.outputs.updated, 'true');
  assert.match(run.summary, /ACME-42/);
});

test('block mode keeps the author text', async (t) => {
  const server = await startServer({ issue: ISSUE, pullRequest: PULL_REQUEST });
  t.after(() => server.close());

  const run = await runAction({
    url: server.url,
    payload: { pull_request: PULL_REQUEST },
    inputs: {
      'github-token': 'token',
      'jira-base-url': server.url,
      'jira-email': 'bot@example.com',
      'jira-token': 'secret',
      mode: 'block',
    },
  });

  assert.equal(run.code, 0, run.stdout);

  const body = JSON.parse(server.requests.find((request) => request.method === 'PATCH').body).body;

  assert.match(body, /Original body written by the author\./);
  assert.match(body, /<!-- jira-sync:start -->/);
});

test('a dry run changes nothing and still fills the summary', async (t) => {
  const server = await startServer({ issue: ISSUE, pullRequest: PULL_REQUEST });
  t.after(() => server.close());

  const run = await runAction({
    url: server.url,
    payload: { pull_request: PULL_REQUEST },
    inputs: {
      'github-token': 'token',
      'jira-base-url': server.url,
      'jira-email': 'bot@example.com',
      'jira-token': 'secret',
      'dry-run': 'true',
    },
  });

  assert.equal(run.code, 0, run.stdout);
  assert.equal(server.requests.filter((request) => request.method === 'PATCH').length, 0);
  assert.match(run.summary, /dry run/);
  assert.match(run.summary, /Divider ignores the theme accent colour/);
  assert.equal(run.outputs.updated, 'false');
});

test('the branch is used when the event carries no pull request', async (t) => {
  const server = await startServer({ issue: ISSUE, pullRequest: PULL_REQUEST });
  t.after(() => server.close());

  const run = await runAction({
    url: server.url,
    payload: {},
    inputs: {
      'github-token': 'token',
      'jira-base-url': server.url,
      'jira-email': 'bot@example.com',
      'jira-token': 'secret',
    },
  });

  assert.equal(run.code, 0, run.stdout);
  assert.ok(server.requests.some((request) => /\/pulls\?.*head=octo%3Aacme-42/.test(request.url)));
  assert.ok(server.requests.some((request) => request.method === 'PATCH'));
});

test('an unreadable issue warns by default and fails when asked to', async (t) => {
  const server = await startServer({ issue: ISSUE, pullRequest: PULL_REQUEST });
  t.after(() => server.close());

  const base = {
    url: server.url,
    payload: { pull_request: { ...PULL_REQUEST, head: { ref: 'no-ticket-here' }, title: 'chore', body: '' } },
    ref: 'refs/heads/no-ticket-here',
    inputs: {
      'github-token': 'token',
      'jira-base-url': server.url,
      'jira-email': 'bot@example.com',
      'jira-token': 'secret',
    },
  };

  const lenient = await runAction(base);

  assert.equal(lenient.code, 0, lenient.stdout);
  assert.match(lenient.stdout, /::warning::No issue key found/);

  const strict = await runAction({ ...base, inputs: { ...base.inputs, 'fail-on-missing': 'true' } });

  assert.equal(strict.code, 1);
  assert.match(strict.stdout, /::error::No issue key found/);
});
