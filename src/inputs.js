'use strict';

/**
 * Reads and validates the action inputs.
 */

const core = require('@actions/core');
const { normaliseBaseUrl } = require('./jira');

const ATTACHMENT_MODES = ['details', 'inline', 'off'];
const WRITE_MODES = ['replace', 'block'];

/**
 * Reads every input and returns them in their usable form.
 *
 * @param {Function} [get] Input reader, injectable for tests.
 * @returns {object} Parsed inputs.
 */
function readInputs(get = (name) => core.getInput(name)) {
  const attachments = (get('attachments') || 'details').trim().toLowerCase();
  const mode = (get('mode') || 'replace').trim().toLowerCase();

  if (!ATTACHMENT_MODES.includes(attachments)) {
    throw new Error(`attachments must be one of ${ATTACHMENT_MODES.join(', ')}, got "${attachments}".`);
  }

  if (!WRITE_MODES.includes(mode)) {
    throw new Error(`mode must be one of ${WRITE_MODES.join(', ')}, got "${mode}".`);
  }

  return {
    githubToken: get('github-token'),
    baseUrl: normaliseBaseUrl(get('jira-base-url')),
    email: (get('jira-email') || '').trim(),
    token: (get('jira-token') || '').trim(),
    issue: (get('issue') || '').trim(),
    issuePattern: (get('issue-pattern') || '([A-Za-z][A-Za-z0-9]+-\\d+)').trim(),
    prNumber: toNumber(get('pr-number')),
    mode,
    attachments,
    criteriaSection: toBoolean(get('criteria-section'), true),
    criteriaHeadings: toList(get('criteria-headings')),
    collapseOver: toNumber(get('collapse-over')) || 0,
    metadataTable: toBoolean(get('metadata-table'), false),
    checklist: get('checklist') || '',
    template: get('template') || '',
    failOnMissing: toBoolean(get('fail-on-missing'), false),
    dryRun: toBoolean(get('dry-run'), false),
  };
}

/**
 * Finds an issue key in the first candidate that holds one.
 *
 * @param {string} pattern Regular expression source. The first capture group is the key.
 * @param {Array<string|undefined>} candidates Strings to search, in priority order.
 * @returns {string} Upper cased issue key, or an empty string.
 */
function detectIssueKey(pattern, candidates) {
  let expression;

  try {
    expression = new RegExp(pattern);
  } catch (error) {
    throw new Error(`issue-pattern is not a valid regular expression: ${error.message}`);
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const match = String(candidate).match(expression);

    if (match) {
      return (match[1] || match[0]).toUpperCase();
    }
  }

  return '';
}

/**
 * Parses a boolean input, accepting the spellings people actually write in YAML.
 *
 * @param {string} value Raw input.
 * @param {boolean} fallback Value used when the input is empty.
 * @returns {boolean} Parsed value.
 */
function toBoolean(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase();

  if (!text) {
    return fallback;
  }

  if (['true', 'yes', 'on', '1'].includes(text)) {
    return true;
  }

  if (['false', 'no', 'off', '0'].includes(text)) {
    return false;
  }

  return fallback;
}

/**
 * Parses a number input.
 *
 * @param {string} value Raw input.
 * @returns {number} Parsed number, or 0.
 */
function toNumber(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Splits a comma separated input into trimmed, lower case entries.
 *
 * @param {string} value Raw input.
 * @returns {string[]} List entries.
 */
function toList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = { readInputs, detectIssueKey, toBoolean, toNumber, toList };
