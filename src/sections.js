'use strict';

/**
 * Builds the individual pieces of the pull request body out of the converted description.
 */

/** Matches an ATX heading and captures its text. */
const HEADING = /^#{1,6}\s+(.*?)\s*#*$/;

/** Matches a line that is nothing but bold text, which is how Jira authors usually write headings. */
const BOLD_LINE = /^\*\*(.+?)\*\*:?\s*$/;

/**
 * Splits an acceptance criteria or testing section out of the description so it can be given its own
 * heading. Authors write these as a bold line rather than a real heading, which makes them easy to
 * miss in a long ticket.
 *
 * @param {string} markdown Converted description.
 * @param {string[]} headings Lower case heading texts that start the section.
 * @returns {{description: string, criteria: string}} The description without the section, and the
 *   section body. `criteria` is empty when no matching heading is present.
 */
function splitCriteria(markdown, headings) {
  const lines = String(markdown).split('\n');
  const wanted = headings.map(normaliseHeading).filter(Boolean);
  const start = lines.findIndex((line) => {
    const text = headingText(line);
    return text !== null && wanted.includes(normaliseHeading(text));
  });

  if (start === -1) {
    return { description: markdown, criteria: '' };
  }

  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingText(lines[index]) !== null) {
      end = index;
      break;
    }
  }

  const criteria = lines.slice(start + 1, end).join('\n').trim();

  // A heading with nothing under it is not worth moving.
  if (!criteria) {
    return { description: markdown, criteria: '' };
  }

  const description = [...lines.slice(0, start), ...lines.slice(end)].join('\n');

  return { description: squeeze(description), criteria };
}

/**
 * Returns the text of a line when that line acts as a heading.
 *
 * @param {string} line A single Markdown line.
 * @returns {string|null} Heading text, or null when the line is ordinary content.
 */
function headingText(line) {
  const heading = line.match(HEADING);

  if (heading) {
    return heading[1];
  }

  const bold = line.match(BOLD_LINE);

  return bold ? bold[1] : null;
}

/**
 * Normalises a heading for comparison.
 *
 * @param {string} value Heading text.
 * @returns {string} Lower case text without punctuation or repeated spaces.
 */
function normaliseHeading(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[*_`:#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the attachments section.
 *
 * @param {object} options Section options.
 * @param {Array<{name: string, url: string}>} options.images Images found inline in the description.
 * @param {Array<{name: string, url: string, size: number}>} options.attachments Everything attached
 *   to the issue, which can include files that are not referenced in the description.
 * @param {string} options.mode `details`, `inline` or `off`.
 * @returns {string} Markdown for the section, or an empty string.
 */
function buildAttachments({ images = [], attachments = [], mode = 'details' }) {
  if (mode !== 'details') {
    return '';
  }

  const bySize = new Map(attachments.map((item) => [item.url, item]));
  const merged = [];

  for (const item of [...images, ...attachments]) {
    if (!item.url || merged.some((existing) => existing.url === item.url)) {
      continue;
    }

    merged.push({ ...item, size: bySize.get(item.url)?.size });
  }

  if (!merged.length) {
    return '';
  }

  const rows = merged
    .map((item) => `| [${escapeCell(item.name)}](${item.url}) | ${formatBytes(item.size)} |`)
    .join('\n');

  return [
    '<details>',
    `<summary>📎 Attachments (${merged.length})</summary>`,
    '',
    '| File | Size |',
    '| --- | --- |',
    rows,
    '',
    '_Attachment links open in Jira and need you to be signed in._',
    '</details>',
  ].join('\n');
}

/**
 * Builds the issue metadata table.
 *
 * @param {object} issue Flattened issue details.
 * @returns {string} Markdown table, or an empty string when nothing is known.
 */
function buildMetadata(issue) {
  const columns = [
    ['Type', issue.type],
    ['Status', issue.status],
    ['Priority', issue.priority],
    ['Assignee', issue.assignee],
    ['Parent', issue.parent ? `[${issue.parent.key}](${issue.parent.url})` : ''],
    ['Labels', issue.labels.map((label) => `\`${label}\``).join(' ')],
    ['Fix version', issue.fixVersions.join(', ')],
  ].filter(([, value]) => value);

  if (!columns.length) {
    return '';
  }

  return [
    `| ${columns.map(([label]) => label).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    `| ${columns.map(([, value]) => escapeCell(value)).join(' | ')} |`,
  ].join('\n');
}

/**
 * Wraps long descriptions so the body stays scannable. The blank line after the summary is required,
 * without it GitHub renders the Markdown inside as plain text.
 *
 * @param {string} markdown Description Markdown.
 * @param {number} limit Character limit, 0 disables collapsing.
 * @param {string} [summary] Summary line for the disclosure.
 * @returns {string} Possibly wrapped Markdown.
 */
function collapse(markdown, limit, summary = '📋 Jira description') {
  const text = String(markdown).trim();

  if (!text || !limit || text.length <= limit) {
    return text;
  }

  return ['<details>', `<summary>${summary}</summary>`, '', text, '', '</details>'].join('\n');
}

/**
 * Renders a checklist from newline separated items.
 *
 * @param {string} value Raw `checklist` input.
 * @returns {string} Markdown checklist, or an empty string.
 */
function buildChecklist(value) {
  const items = String(value || '')
    .split('\n')
    .map((item) => item.replace(/^\s*[-*]\s*/, '').replace(/^\[[ xX]?\]\s*/, '').trim())
    .filter(Boolean);

  return items.map((item) => `- [ ] ${item}`).join('\n');
}

/**
 * Formats a byte count for display.
 *
 * @param {number} bytes Size in bytes.
 * @returns {string} Human readable size, or an empty string when unknown.
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Makes a value safe to place inside a table cell.
 *
 * @param {string} value Cell content.
 * @returns {string} Content with pipes and newlines neutralised.
 */
function escapeCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Collapses runs of blank lines.
 *
 * @param {string} value Markdown.
 * @returns {string} Markdown with at most one blank line in a row.
 */
function squeeze(value) {
  return String(value).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  splitCriteria,
  buildAttachments,
  buildMetadata,
  buildChecklist,
  collapse,
  formatBytes,
  squeeze,
};
