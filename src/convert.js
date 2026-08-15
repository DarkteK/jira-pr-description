'use strict';

/**
 * Converts the HTML Jira renders for an issue description into GitHub-Flavored Markdown.
 *
 * Jira hands back HTML through `expand=renderedFields`, so every rich text feature (ordered lists,
 * bold, links, tables, code blocks, panels) arrives as ordinary markup. The job here is to map that
 * markup onto Markdown that GitHub renders the same way Jira does, and to deal with the handful of
 * Jira specific wrappers that would otherwise leak into the pull request.
 */

const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

/** Jira panel flavours mapped onto GitHub alert types. */
const ALERT_TYPES = {
  info: 'NOTE',
  note: 'NOTE',
  tip: 'TIP',
  success: 'TIP',
  warning: 'WARNING',
  caution: 'WARNING',
  error: 'CAUTION',
  important: 'IMPORTANT',
};

/**
 * Converts rendered Jira HTML to Markdown.
 *
 * @param {string} html Value of `renderedFields.description`.
 * @param {object} options Conversion options.
 * @param {string} options.baseUrl Jira base URL, used to make relative links absolute.
 * @param {string} [options.attachmentsMode] `details`, `inline` or `off`.
 * @returns {{markdown: string, images: Array<{name: string, url: string}>}} Markdown plus every
 *   inline image that was found, in document order.
 */
function convert(html, { baseUrl, attachmentsMode = 'details' }) {
  const images = [];

  if (!html || !String(html).trim()) {
    return { markdown: '', images };
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '',
  });

  turndown.use(gfm);
  turndown.remove(['script', 'style', 'head', 'meta', 'link', 'noscript']);

  addImageRule(turndown, { baseUrl, attachmentsMode, images });
  addAnchorRule(turndown, { baseUrl });
  addLozengeRule(turndown);
  addCodeBlockRule(turndown);
  addPanelRule(turndown);

  return { markdown: tidy(turndown.turndown(html)), images };
}

/**
 * Images cannot be embedded: Jira attachment URLs require a signed in session, and private
 * repositories will not render remote images anyway. Each image becomes a labelled link instead,
 * and is recorded so the caller can also list it in an attachments section.
 *
 * @param {object} turndown Turndown instance.
 * @param {object} context Rule context.
 * @returns {void}
 */
function addImageRule(turndown, { baseUrl, attachmentsMode, images }) {
  turndown.addRule('jiraImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const source = resolveUrl(node.getAttribute('src'), baseUrl);
      const alt = (node.getAttribute('alt') || '').trim();
      const className = node.getAttribute('class') || '';

      // Emoji and emoticons are rendered as tiny images. Their alt text is the emoji itself.
      if (/emoticon|emoji/i.test(className) || /\/emoji\//i.test(source)) {
        return alt;
      }

      if (!source) {
        return alt;
      }

      const name = alt || fileNameFromUrl(source) || 'attachment';
      const inAnchor = node.parentNode && node.parentNode.nodeName === 'A';

      // A thumbnail wrapped in a link points at a preview; the link itself points at the file.
      const target = inAnchor
        ? resolveUrl(node.parentNode.getAttribute('href'), baseUrl) || source
        : source;

      if (!images.some((image) => image.url === target)) {
        images.push({ name, url: target });
      }

      if (attachmentsMode === 'off') {
        return '';
      }

      // Inside an anchor the surrounding rule already produces the link, so emit plain text.
      if (inAnchor) {
        return `📎 ${name}`;
      }

      return `[📎 ${name}](${wrapUrl(source)})`;
    },
  });
}

/**
 * Link handling covers three cases Jira produces: user mentions, smart links whose visible text is
 * the URL itself, and ordinary links. URLs holding characters that break inline link syntax are
 * emitted with an angle bracket destination.
 *
 * @param {object} turndown Turndown instance.
 * @param {object} context Rule context.
 * @returns {void}
 */
function addAnchorRule(turndown, { baseUrl }) {
  turndown.addRule('jiraAnchor', {
    filter: (node) => node.nodeName === 'A',
    replacement: (content, node) => {
      const className = node.getAttribute('class') || '';
      const text = collapseWhitespace(node.textContent);

      // Mentions are rendered bold rather than as an @handle, so a Jira name can never turn into an
      // accidental GitHub notification for an unrelated account.
      if (/mention|user-hover/i.test(className)) {
        const name = text.replace(/^@/, '').trim();
        return name ? `**@${name}**` : '';
      }

      const href = resolveUrl(node.getAttribute('href'), baseUrl);

      if (!href) {
        return content;
      }

      // A smart link shows the raw URL as its own label. An autolink keeps that readable and avoids
      // escaping every underscore and asterisk in a long tracking query string.
      if (sameUrl(text, href)) {
        return `<${href}>`;
      }

      const label = collapseWhitespace(content) || text || href;

      return `[${label}](${wrapUrl(href)})`;
    },
  });
}

/**
 * Status lozenges ("IN PROGRESS" pills) become inline code so they stay visually distinct.
 *
 * @param {object} turndown Turndown instance.
 * @returns {void}
 */
function addLozengeRule(turndown) {
  turndown.addRule('jiraLozenge', {
    filter: (node) =>
      node.nodeName === 'SPAN' && /lozenge|status-macro/i.test(node.getAttribute('class') || ''),
    replacement: (content) => {
      const text = collapseWhitespace(content);
      return text ? `\`${text}\`` : '';
    },
  });
}

/**
 * Jira wraps code in `<pre class="code-java">` inside a panel, which the default rule would turn
 * into an indented block with no language.
 *
 * @param {object} turndown Turndown instance.
 * @returns {void}
 */
function addCodeBlockRule(turndown) {
  turndown.addRule('jiraCodeBlock', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const code = node.textContent.replace(/\n+$/, '');
      const fence = longestFence(code);

      return `\n\n${fence}${detectLanguage(node)}\n${code}\n${fence}\n\n`;
    },
  });
}

/**
 * Info, warning and note panels become GitHub alerts.
 *
 * @param {object} turndown Turndown instance.
 * @returns {void}
 */
function addPanelRule(turndown) {
  turndown.addRule('jiraPanel', {
    filter: (node) => {
      if (node.nodeName !== 'DIV') {
        return false;
      }

      const className = node.getAttribute('class') || '';

      return Boolean(node.getAttribute('data-macro-name')) || /\b(panel|aui-message)\b/.test(className);
    },
    replacement: (content, node) => {
      const body = content.trim();

      if (!body) {
        return '';
      }

      // Code panels are a wrapper around <pre>, which already produced a fenced block.
      if (node.querySelector && node.querySelector('pre')) {
        return `\n\n${body}\n\n`;
      }

      const tokens = `${node.getAttribute('data-macro-name') || ''} ${node.getAttribute('class') || ''}`
        .toLowerCase()
        .split(/[^a-z]+/);
      const type = tokens.map((token) => ALERT_TYPES[token]).find(Boolean) || 'NOTE';
      const quoted = body
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n');

      return `\n\n> [!${type}]\n${quoted}\n\n`;
    },
  });
}

/**
 * Picks a fence long enough to contain the sample, so a snippet holding a triple backtick does not
 * end the block early.
 *
 * @param {string} code Code sample.
 * @returns {string} Backtick fence.
 */
function longestFence(code) {
  const runs = code.match(/`{3,}/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);

  return '`'.repeat(longest + 1);
}

/**
 * Reads the language out of a code block.
 *
 * Jira's `code-java` class is a styling hook that it applies to every snippet regardless of the
 * real language, so it is deliberately ignored. Only an explicit `language-*`, `brush:` or
 * `data-language` declaration is trusted.
 *
 * @param {object} node `<pre>` element.
 * @returns {string} Language identifier, or an empty string.
 */
function detectLanguage(node) {
  const child = node.querySelector ? node.querySelector('code') : null;
  const declared = node.getAttribute('data-language') || (child && child.getAttribute('data-language'));

  if (declared) {
    return declared.trim().toLowerCase();
  }

  const className = `${node.getAttribute('class') || ''} ${(child && child.getAttribute('class')) || ''}`;
  const match = className.match(/(?:^|\s)(?:language-|brush:\s*)([a-z0-9+#]+)/i);
  const language = match ? match[1].toLowerCase() : '';

  return ['none', 'null', 'text', 'plain'].includes(language) ? '' : language;
}

/**
 * Makes a URL absolute against the Jira base URL.
 *
 * @param {string} value Raw href or src.
 * @param {string} baseUrl Jira base URL.
 * @returns {string} Absolute URL, or an empty string when there is nothing usable.
 */
function resolveUrl(value, baseUrl) {
  const raw = (value || '').trim();

  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) {
    return '';
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return raw;
  }

  return `${String(baseUrl || '').replace(/\/+$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/**
 * Wraps a destination in angle brackets when it holds characters that would break inline link
 * syntax. Jira links routinely carry analytics query strings full of brackets and asterisks.
 *
 * @param {string} url Absolute URL.
 * @returns {string} Link destination ready to be placed between parentheses.
 */
function wrapUrl(url) {
  return /[()\s<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

/**
 * Compares a link label with its destination, ignoring a trailing slash and a missing scheme.
 *
 * @param {string} text Visible label.
 * @param {string} href Destination.
 * @returns {boolean} True when the label is just the URL.
 */
function sameUrl(text, href) {
  const strip = (value) =>
    String(value || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');

  return Boolean(text) && strip(text) === strip(href);
}

/**
 * Extracts a file name from a URL path.
 *
 * @param {string} url Absolute URL.
 * @returns {string} Last path segment without a query string.
 */
function fileNameFromUrl(url) {
  const path = String(url).split(/[?#]/)[0];
  const segment = path.substring(path.lastIndexOf('/') + 1);

  return decodeURIComponent(segment || '');
}

/**
 * Flattens any run of whitespace, including newlines, into single spaces.
 *
 * @param {string} value Text to flatten.
 * @returns {string} Single line text.
 */
function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleans up the artefacts of HTML conversion: non breaking spaces, trailing whitespace and the long
 * runs of blank lines that Jira's spacer paragraphs leave behind.
 *
 * @param {string} markdown Raw conversion output.
 * @returns {string} Tidied Markdown.
 */
function tidy(markdown) {
  return String(markdown)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { convert, resolveUrl, wrapUrl, tidy };
