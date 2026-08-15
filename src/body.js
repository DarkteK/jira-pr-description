'use strict';

/**
 * Assembles the final pull request body and decides how it is written back.
 */

const { squeeze } = require('./sections');

const START_MARKER = '<!-- jira-sync:start -->';
const END_MARKER = '<!-- jira-sync:end -->';

/** GitHub rejects a pull request body longer than 65536 characters. */
const MAX_BODY = 65536;

/** Room left for the marker comments and the truncation notice. */
const TRUNCATION_MARGIN = 400;

const DEFAULT_TEMPLATE = [
  '## [{{key}}]({{url}}) {{summary}}',
  '',
  '{{metadata}}',
  '',
  '{{description}}',
  '',
  '{{criteria}}',
  '',
  '{{attachments}}',
  '',
  '{{checklist}}',
].join('\n');

/**
 * Fills a template with the generated sections.
 *
 * Placeholders that have no content disappear along with the blank lines around them, so a template
 * never leaves a hole where an optional section would have been.
 *
 * @param {string} template Template text, or an empty string to use the default.
 * @param {Record<string, string>} values Section content keyed by placeholder name.
 * @returns {string} Rendered body.
 */
function render(template, values) {
  const source = String(template || '').trim() || DEFAULT_TEMPLATE;
  const filled = source.replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, (_match, name) => {
    const value = values[name];
    return value === undefined || value === null ? '' : String(value);
  });

  return squeeze(filled);
}

/**
 * Produces the body to send to GitHub.
 *
 * @param {object} options Write options.
 * @param {string} options.existing Current pull request body.
 * @param {string} options.generated Rendered Jira content.
 * @param {string} options.mode `replace` or `block`.
 * @returns {string} The complete new body.
 */
function applyMode({ existing, generated, mode }) {
  const content = truncate(generated);

  if (mode !== 'block') {
    return content;
  }

  const block = `${START_MARKER}\n${content}\n${END_MARKER}`;
  const current = String(existing || '');
  const start = current.indexOf(START_MARKER);
  const end = current.indexOf(END_MARKER);

  if (start !== -1 && end > start) {
    const before = current.slice(0, start);
    const after = current.slice(end + END_MARKER.length);

    return truncate(`${before}${block}${after}`, MAX_BODY);
  }

  // No markers yet: keep whatever the author wrote and put the Jira content above it.
  return truncate(current.trim() ? `${block}\n\n${current.trim()}` : block, MAX_BODY);
}

/**
 * Trims a body down to what GitHub accepts, cutting on a line boundary and saying so.
 *
 * @param {string} value Body text.
 * @param {number} [limit] Maximum length.
 * @returns {string} Body within the limit.
 */
function truncate(value, limit = MAX_BODY - TRUNCATION_MARGIN) {
  const text = String(value);

  if (text.length <= limit) {
    return text;
  }

  const notice = '\n\n_This description was shortened because it exceeds the GitHub size limit. Open the Jira issue for the rest._';
  const cut = text.slice(0, limit - notice.length);
  const boundary = cut.lastIndexOf('\n');

  return `${(boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd()}${notice}`;
}

module.exports = { render, applyMode, truncate, DEFAULT_TEMPLATE, START_MARKER, END_MARKER, MAX_BODY };
