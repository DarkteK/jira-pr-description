'use strict';

/**
 * Entry point: read the issue, build the body, write it to the pull request.
 */

const core = require('@actions/core');
const github = require('@actions/github');

const { readInputs, detectIssueKey } = require('./inputs');
const { fetchIssue, extractIssue, JiraError } = require('./jira');
const { compose } = require('./compose');
const { applyMode } = require('./body');

/**
 * Runs the action.
 *
 * @returns {Promise<void>} Resolves when the pull request has been handled.
 */
async function run() {
  const inputs = readInputs();
  const octokit = github.getOctokit(inputs.githubToken);
  const { owner, repo } = github.context.repo;

  const pullRequest = await resolvePullRequest(octokit, owner, repo, inputs.prNumber);

  if (!pullRequest) {
    core.warning('No pull request found for this run, nothing to update.');
    core.setOutput('updated', 'false');
    return;
  }

  const issueKey =
    inputs.issue.toUpperCase() ||
    detectIssueKey(inputs.issuePattern, [
      pullRequest.head?.ref,
      pullRequest.title,
      pullRequest.body,
    ]);

  if (!issueKey) {
    report(inputs, `No issue key found in the branch name, title or body of PR #${pullRequest.number}.`);
    core.setOutput('updated', 'false');
    return;
  }

  core.info(`Reading ${issueKey} from ${inputs.baseUrl}`);

  let issue;

  try {
    const { issue: payload, apiVersion } = await fetchIssue({
      baseUrl: inputs.baseUrl,
      email: inputs.email,
      token: inputs.token,
      issueKey,
    });

    core.debug(`Jira REST API v${apiVersion} answered for ${issueKey}.`);
    issue = extractIssue(payload, inputs.baseUrl);
  } catch (error) {
    if (error instanceof JiraError) {
      report(inputs, error.message);
      core.setOutput('updated', 'false');
      return;
    }

    throw error;
  }

  const { markdown } = compose(issue, {
    baseUrl: inputs.baseUrl,
    attachments: inputs.attachments,
    criteriaSection: inputs.criteriaSection,
    criteriaHeadings: inputs.criteriaHeadings,
    collapseOver: inputs.collapseOver,
    metadataTable: inputs.metadataTable,
    checklist: inputs.checklist,
    template: inputs.template,
  });

  const body = applyMode({
    existing: pullRequest.body || '',
    generated: markdown,
    mode: inputs.mode,
  });

  setIssueOutputs(issue, markdown);
  await writeSummary(issueKey, markdown, inputs.dryRun);

  if (inputs.dryRun) {
    core.info('dry-run is on, the pull request was left untouched.');
    core.setOutput('updated', 'false');
    return;
  }

  if (body === (pullRequest.body || '')) {
    core.info('The pull request body is already up to date.');
    core.setOutput('updated', 'false');
    return;
  }

  await octokit.rest.pulls.update({ owner, repo, pull_number: pullRequest.number, body });

  core.info(`Updated the description of PR #${pullRequest.number} from ${issueKey}.`);
  core.setOutput('updated', 'true');
}

/**
 * Finds the pull request to update.
 *
 * On `pull_request` events it comes straight from the payload. Everything else, including
 * `workflow_dispatch`, falls back to the explicit input and then to a lookup by branch, so the
 * workflow can be re-run by hand.
 *
 * @param {object} octokit Authenticated client.
 * @param {string} owner Repository owner.
 * @param {string} repo Repository name.
 * @param {number} prNumber Explicit pull request number, or 0.
 * @returns {Promise<object|null>} Pull request, or null when there is none.
 */
async function resolvePullRequest(octokit, owner, repo, prNumber) {
  const fromPayload = github.context.payload.pull_request;

  if (!prNumber && fromPayload) {
    return fromPayload;
  }

  if (prNumber) {
    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    return data;
  }

  const branch = (github.context.ref || '').replace(/^refs\/heads\//, '');

  if (!branch) {
    return null;
  }

  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  });

  return data[0] || null;
}

/**
 * Publishes the issue details as step outputs.
 *
 * @param {object} issue Flattened issue details.
 * @param {string} markdown Generated Markdown.
 * @returns {void}
 */
function setIssueOutputs(issue, markdown) {
  core.setOutput('issue-key', issue.key);
  core.setOutput('issue-url', issue.url);
  core.setOutput('summary', issue.summary);
  core.setOutput('status', issue.status);
  core.setOutput('assignee', issue.assignee);
  core.setOutput('markdown', markdown);
}

/**
 * Writes the generated body to the job summary so a run can be inspected without opening the pull
 * request, which is the only output a dry run produces.
 *
 * @param {string} issueKey Issue key.
 * @param {string} markdown Generated Markdown.
 * @param {boolean} dryRun Whether this run is a dry run.
 * @returns {Promise<void>} Resolves once the summary is written.
 */
async function writeSummary(issueKey, markdown, dryRun) {
  try {
    await core.summary
      .addHeading(`${issueKey}${dryRun ? ' (dry run)' : ''}`, 3)
      .addRaw(markdown)
      .write();
  } catch (error) {
    core.debug(`Could not write the job summary: ${error.message}`);
  }
}

/**
 * Reports a problem as a failure or a warning, depending on `fail-on-missing`.
 *
 * @param {object} inputs Parsed inputs.
 * @param {string} message What went wrong.
 * @returns {void}
 */
function report(inputs, message) {
  if (inputs.failOnMissing) {
    core.setFailed(message);
    return;
  }

  core.warning(`${message} Continuing because fail-on-missing is false.`);
}

run().catch((error) => {
  core.setFailed(error.message);
});

module.exports = { run };
