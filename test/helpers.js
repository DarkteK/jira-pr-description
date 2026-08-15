'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'https://your-org.atlassian.net';

/**
 * Loads a fixture from disk.
 *
 * @param {string} name File name inside `test/fixtures`.
 * @returns {string} File contents.
 */
function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

/**
 * Builds an issue in the shape `extractIssue` produces.
 *
 * @param {object} [overrides] Fields to override.
 * @returns {object} Issue details.
 */
function issue(overrides = {}) {
  return {
    key: 'ACME-42',
    url: `${BASE_URL}/browse/ACME-42`,
    summary: 'Divider ignores the theme accent colour',
    descriptionHtml: '',
    status: 'In Progress',
    type: 'Bug',
    priority: 'Medium',
    assignee: 'Dana Fields',
    parent: null,
    labels: [],
    fixVersions: [],
    attachments: [],
    ...overrides,
  };
}

module.exports = { fixture, issue, BASE_URL };
