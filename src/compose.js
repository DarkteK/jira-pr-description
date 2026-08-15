'use strict';

/**
 * Turns a Jira issue into the Markdown that goes in the pull request body.
 *
 * Kept separate from the GitHub plumbing so the whole pipeline can be exercised, and previewed
 * locally, without an event payload or an API token.
 */

const { convert } = require('./convert');
const {
  splitCriteria,
  buildAttachments,
  buildMetadata,
  buildChecklist,
  collapse,
} = require('./sections');
const { render } = require('./body');

const CRITERIA_HEADING = '### ✅ Testing and acceptance criteria';

/**
 * Composes the body content for an issue.
 *
 * @param {object} issue Flattened issue details from `extractIssue`.
 * @param {object} options Formatting options.
 * @param {string} options.baseUrl Jira base URL.
 * @param {string} [options.attachments] `details`, `inline` or `off`.
 * @param {boolean} [options.criteriaSection] Lift the criteria section out of the description.
 * @param {string[]} [options.criteriaHeadings] Headings that start the criteria section.
 * @param {number} [options.collapseOver] Collapse the description above this length.
 * @param {boolean} [options.metadataTable] Include the metadata table.
 * @param {string} [options.checklist] Newline separated checklist items.
 * @param {string} [options.template] Body template.
 * @returns {{markdown: string, images: Array<{name: string, url: string}>}} Rendered body.
 */
function compose(issue, options) {
  const {
    baseUrl,
    attachments = 'details',
    criteriaSection = true,
    criteriaHeadings = [],
    collapseOver = 0,
    metadataTable = false,
    checklist = '',
    template = '',
  } = options;

  const { markdown, images } = convert(issue.descriptionHtml, {
    baseUrl,
    attachmentsMode: attachments,
  });

  const split = criteriaSection
    ? splitCriteria(markdown, criteriaHeadings)
    : { description: markdown, criteria: '' };

  const description = collapse(split.description, collapseOver);
  const criteria = split.criteria ? `${CRITERIA_HEADING}\n\n${split.criteria}` : '';

  const body = render(template, {
    key: issue.key,
    summary: issue.summary,
    url: issue.url,
    status: issue.status,
    type: issue.type,
    assignee: issue.assignee,
    metadata: metadataTable ? buildMetadata(issue) : '',
    description: description || '_This issue has no description._',
    criteria,
    attachments: buildAttachments({
      images,
      attachments: issue.attachments,
      mode: attachments,
    }),
    checklist: buildChecklist(checklist),
  });

  return { markdown: body, images };
}

module.exports = { compose, CRITERIA_HEADING };
