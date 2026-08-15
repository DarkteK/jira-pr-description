'use strict';

/**
 * Minimal Jira REST client.
 *
 * Only one endpoint is needed: the issue, expanded with `renderedFields`. That expansion makes Jira
 * render its own rich text server side and hand back HTML, which sidesteps the whole problem of
 * parsing Atlassian Document Format (Cloud) or wiki markup (Data Center) in the action.
 */

const FIELDS = [
  'summary',
  'description',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'parent',
  'labels',
  'attachment',
  'fixVersions',
].join(',');

/** API versions to try, in order. Cloud answers on 3, older Data Center only on 2. */
const API_VERSIONS = ['3', '2'];

class JiraError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
  }
}

/**
 * Normalises a user supplied base URL: adds a scheme when missing and drops any trailing slash.
 *
 * @param {string} value Raw `jira-base-url` input.
 * @returns {string} Base URL without a trailing slash.
 */
function normaliseBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('jira-base-url is empty.');
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Fetches an issue together with its rendered HTML fields.
 *
 * @param {object} options Request options.
 * @param {string} options.baseUrl Normalised Jira base URL.
 * @param {string} options.email Account email.
 * @param {string} options.token API token.
 * @param {string} options.issueKey Issue key, for example `ACME-42`.
 * @param {Function} [options.fetchImpl] Injectable fetch, used by the tests.
 * @returns {Promise<{issue: object, apiVersion: string}>} Issue payload and the version that answered.
 */
async function fetchIssue({ baseUrl, email, token, issueKey, fetchImpl = fetch }) {
  const authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  let lastError;

  for (const apiVersion of API_VERSIONS) {
    const url =
      `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}` +
      `?expand=renderedFields&fields=${FIELDS}`;

    let response;

    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new JiraError(`Could not reach Jira at ${baseUrl}: ${error.message}`, 0);
    }

    if (response.ok) {
      return { issue: await response.json(), apiVersion };
    }

    lastError = new JiraError(describeFailure(response.status, issueKey), response.status);

    // A 404 can mean "wrong API version for this Jira", so it is worth retrying on the older one.
    // Anything else (auth, permissions, rate limit) will fail the same way twice.
    if (response.status !== 404) {
      break;
    }
  }

  throw lastError;
}

/**
 * Turns an HTTP status into an error message that says what to check.
 *
 * @param {number} status HTTP status code.
 * @param {string} issueKey Issue key that was requested.
 * @returns {string} Human readable explanation.
 */
function describeFailure(status, issueKey) {
  switch (status) {
    case 401:
      return `Jira rejected the credentials (401). Check jira-email and jira-token.`;
    case 403:
      return `Jira refused the request (403). The account may lack permission to view ${issueKey}.`;
    case 404:
      return `Issue ${issueKey} was not found (404). Check the key and the jira-base-url.`;
    case 429:
      return `Jira is rate limiting the request (429). Try again later.`;
    default:
      return `Jira responded with HTTP ${status} for ${issueKey}.`;
  }
}

/**
 * Reads the fields the action cares about out of a raw issue payload.
 *
 * @param {object} issue Raw issue as returned by the REST API.
 * @param {string} baseUrl Normalised Jira base URL.
 * @returns {object} Flattened issue details.
 */
function extractIssue(issue, baseUrl) {
  const fields = issue.fields || {};
  const rendered = issue.renderedFields || {};

  return {
    key: issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    summary: fields.summary || '',
    descriptionHtml: rendered.description || '',
    status: fields.status?.name || '',
    type: fields.issuetype?.name || '',
    priority: fields.priority?.name || '',
    assignee: fields.assignee?.displayName || '',
    parent: fields.parent
      ? {
          key: fields.parent.key,
          summary: fields.parent.fields?.summary || '',
          url: `${baseUrl}/browse/${fields.parent.key}`,
        }
      : null,
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    fixVersions: (fields.fixVersions || []).map((version) => version.name).filter(Boolean),
    attachments: (fields.attachment || []).map((attachment) => ({
      name: attachment.filename,
      url: attachment.content,
      size: attachment.size,
      mimeType: attachment.mimeType || '',
    })),
  };
}

module.exports = { fetchIssue, extractIssue, normaliseBaseUrl, JiraError };
