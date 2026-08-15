#!/usr/bin/env node
'use strict';

/**
 * Prints the pull request body this action would generate for an issue.
 *
 * Nothing is written anywhere: it reads the issue and prints Markdown, which makes it the quickest
 * way to check a template change against a real ticket.
 *
 *   cp .env.example .env   # fill in your Jira details
 *   npm run preview -- ACME-42
 */

const fs = require('node:fs');
const path = require('node:path');

const { fetchIssue, extractIssue, normaliseBaseUrl } = require('../src/jira');
const { compose } = require('../src/compose');

/**
 * Reads simple KEY=VALUE lines from a .env file, if there is one.
 *
 * @param {string} file Path to the file.
 * @returns {Record<string, string>} Parsed values.
 */
function readEnvFile(file) {
  if (!fs.existsSync(file)) {
    return {};
  }

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .reduce((values, line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);

      if (match && !line.trim().startsWith('#')) {
        values[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }

      return values;
    }, {});
}

/**
 * Runs the preview.
 *
 * @returns {Promise<void>} Resolves once the Markdown has been printed.
 */
async function main() {
  const issueKey = (process.argv[2] || '').trim().toUpperCase();

  if (!issueKey) {
    console.error('Usage: npm run preview -- ISSUE-KEY');
    process.exit(2);
  }

  const env = { ...readEnvFile(path.join(__dirname, '..', '.env')), ...process.env };
  const missing = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_TOKEN'].filter((name) => !env[name]);

  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(2);
  }

  const baseUrl = normaliseBaseUrl(env.JIRA_BASE_URL);
  const { issue: payload, apiVersion } = await fetchIssue({
    baseUrl,
    email: env.JIRA_EMAIL,
    token: env.JIRA_TOKEN,
    issueKey,
  });

  const { markdown } = compose(extractIssue(payload, baseUrl), {
    baseUrl,
    attachments: env.PREVIEW_ATTACHMENTS || 'details',
    criteriaHeadings: (env.PREVIEW_CRITERIA_HEADINGS || 'acceptance criteria,testing steps,test steps,steps to test,qa steps,how to test')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    collapseOver: Number.parseInt(env.PREVIEW_COLLAPSE_OVER || '1500', 10),
    metadataTable: env.PREVIEW_METADATA === 'true',
  });

  console.error(`# rendered from Jira REST API v${apiVersion}, ${markdown.length} characters\n`);
  console.log(markdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
