# Jira PR Description Sync

A GitHub Action that puts the Jira issue behind a branch into the pull request description, as Markdown a reviewer can actually read.

Most actions in this space ask Jira for the issue over REST API v2 and paste the result straight into the body. Jira Cloud stores rich text as Atlassian Document Format, so v2 answers with **wiki markup**, and GitHub renders that literally: a numbered list of test steps turns into a page of giant headings, bold text turns into italics, and links and screenshots disappear.

This action asks Jira to render the issue itself (`expand=renderedFields`) and converts the HTML it gets back into GitHub-Flavored Markdown. Jira does the interpretation, so ADF, wiki markup, tables, code blocks and panels all arrive already resolved.

## What it does

- Converts the full range of Jira rich text: headings, bold, ordered and nested lists, tables, fenced code blocks with a language, quotes, status lozenges and rules.
- Turns Jira info, note, warning and error panels into GitHub alerts.
- Keeps links working. Relative Jira URLs become absolute, destinations holding parentheses or spaces are wrapped so they survive, and a link whose label is its own URL becomes a plain autolink instead of a wall of escaped punctuation from a tracking query string.
- Lifts an "Acceptance criteria" or "Testing steps" section into its own heading, so QA can find it.
- Collapses a long description behind a `<details>` block, and lists attachments in another. Jira attachment URLs need a signed-in session, so they are always links, never broken inline images.
- Renders Jira mentions as bold text, so a name in a ticket cannot notify an unrelated GitHub account.
- Stays out of the way: it skips the update when nothing changed, and truncates on a line boundary rather than being rejected for exceeding GitHub's 65536 character body limit.

## Before and after

The same `ACME-42` description, pasted raw and then converted.

<table>
<tr><th>Pasted from REST API v2</th><th>This action</th></tr>
<tr valign="top"><td>

```
*Issue*

The divider ignores the theme.

!screenshot.png|width=393!

[design spec|https://example.com/spec|smart-link]

*Testing Steps*

# Go to the signup page
# Confirm the accent colour
# Check mobile
```

</td><td>

**Issue**

The divider ignores the theme.

[📎 screenshot.png](#)

<https://example.com/spec>

### ✅ Testing and acceptance criteria

1. Go to the signup page
2. Confirm the accent colour
3. Check mobile

</td></tr>
</table>

Every `#` in the left column is an `<h1>` on GitHub. That is what this action exists to stop.

## Usage

```yaml
name: PR created
on:
  pull_request:
    types: [opened]

permissions:
  contents: read
  pull-requests: write

jobs:
  describe:
    runs-on: ubuntu-latest
    steps:
      - uses: DarkteK/jira-pr-description@v1
        with:
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

That is the whole setup. The issue key is detected automatically from the branch name, then the pull request title, then its body. Branches called `acme-42`, `feature/ACME-42` and `ACME-42-fix-divider` all resolve to `ACME-42`.

### Passing the issue key yourself

When the key does not appear in any of those places, or an earlier step already worked it out, set `issue` explicitly:

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          issue: ACME-42
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

It takes an expression just as happily, which is the usual case when a previous job resolved the ticket:

```yaml
          issue: ${{ needs.jira-issue-info.outputs.JIRA_TICKET }}
```

If your keys simply follow a different shape, leave `issue` alone and change the detection pattern instead. The first capture group is the key:

```yaml
          issue-pattern: '(DEV_[0-9]+)'
```

## Inputs

### `jira-base-url` *(required)*

Your Jira URL, for example `https://your-org.atlassian.net`. A bare hostname works too, `https://` is added for you, and a trailing slash is harmless.

### `jira-email` *(required)*

The email address of the account that owns the API token. It is combined with `jira-token` into a Basic auth header, so the two must belong to the same account.

### `jira-token` *(required)*

A Jira API token, not an account password.

1. Sign in as the account you want the action to read Jira with, and open <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Choose **Create API token**, label it something like `github-actions`, and copy the value. Atlassian shows it once.
3. Save it as a repository secret, for example `JIRA_API_TOKEN`, and pass it as `jira-token`.

The account needs permission to view the issues you want to read, which is **Browse Projects** on the relevant project. That is the same permission the REST API's *Get issue* endpoint checks. A read-only service account is enough; nothing here ever writes to Jira.

### `github-token`

**Default:** `${{ github.token }}`

Used to read and update the pull request, so it needs `pull-requests: write`. Supply a personal access token instead if your organisation restricts the default token.

### `issue`

**Default:** detected from the branch name, then the pull request title, then its body.
**Accepts:** any issue key, such as `ACME-42`.

### `issue-pattern`

**Default:** `([A-Za-z][A-Za-z0-9]+-\d+)`
**Accepts:** any regular expression whose first capture group is the issue key.

Only consulted when `issue` is empty.

### `pr-number`

**Default:** taken from the event payload, and on other events looked up by branch.
**Accepts:** a pull request number, such as `42`.

### `mode`

**Default:** `replace`
**Accepts:** `replace`, `block`

`replace` rewrites the whole body. `block` updates only the marked region and leaves everything else alone. See [Non-destructive updates](#non-destructive-updates) below.

### `attachments`

**Default:** `details`
**Accepts:** `details`, `inline`, `off`

`details` adds a collapsible list of every attachment with its size, `inline` leaves only the links that appear in the description itself, `off` drops them entirely.

### `criteria-section`

**Default:** `true`
**Accepts:** `true`, `false`

Lifts the acceptance criteria out of the description into their own heading.

### `criteria-headings`

**Default:** `acceptance criteria,testing steps,test steps,steps to test,qa steps,how to test`
**Accepts:** any comma separated list of headings, matched case insensitively.

Which headings mark the start of that section. Jira authors usually write them as a bold line rather than a real heading, and both are recognised.

### `collapse-over`

**Default:** `1500`
**Accepts:** any number of characters. `0` never collapses.

Wraps a description longer than this in a `<details>` block.

### `metadata-table`

**Default:** `false`
**Accepts:** `true`, `false`

Adds a table of issue type, status, priority, assignee, parent and labels. Only the columns that have a value appear.

### `checklist`

**Default:** empty, meaning no checklist
**Accepts:** newline separated items, written as plain lines or as `- [ ] item`.

### `template`

**Default:** the built-in layout
**Accepts:** any text using the placeholders `{{key}}`, `{{summary}}`, `{{url}}`, `{{description}}`, `{{criteria}}`, `{{attachments}}`, `{{metadata}}`, `{{checklist}}`.

A placeholder with nothing in it disappears along with the blank lines around it, so optional sections never leave a hole. See [Changing the layout](#changing-the-layout).

### `fail-on-missing`

**Default:** `false`
**Accepts:** `true`, `false`

By default an unreadable or missing issue logs a warning and lets the job pass, because a pull request without a ticket is a normal thing to have. Set it to `true` to fail the step instead.

### `dry-run`

**Default:** `false`
**Accepts:** `true`, `false`

Renders the body into the job summary without touching the pull request.

## Outputs

| Output | Description |
| --- | --- |
| `issue-key` | The key that was used. |
| `issue-url` | Browse URL of the issue. |
| `summary` | Issue summary. |
| `status` | Status name. |
| `assignee` | Assignee display name. |
| `markdown` | The generated Markdown. |
| `updated` | `true` when the body was changed. |

## First time testing this action

Turn on `dry-run` for the first run. The action renders the exact body it would write into the workflow's job summary and stops there, leaving the pull request untouched, so you can confirm the output before it starts editing anything:

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          dry-run: true
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

Open the run in the **Actions** tab and read the summary at the top of the job. When it looks right, delete the `dry-run` line.

One thing that surprises people here: if you store the Jira URL as a secret, every Jira link in that summary shows as `***`. That is GitHub redacting the secret in its own logs, not the action mangling the output. Bodies written to the pull request go over the API and are never redacted.

## Non-destructive updates

`mode: replace`, the default, rewrites the whole description every run. With `mode: block` the action wraps its output in markers and touches only that region, so notes a developer adds to the description survive:

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          mode: block
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

The body then looks like this, and only the marked part is ever rewritten:

```markdown
<!-- jira-sync:start -->
## [ACME-42](https://your-org.atlassian.net/browse/ACME-42) Divider ignores the theme
...
<!-- jira-sync:end -->

Anything written here by hand, including pasted screenshots, is left alone.
```

This matters if you run the action on more than the `opened` event. On `opened` alone there is nothing to protect yet, so `replace` is safe.

## Changing the layout

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          metadata-table: true
          checklist: |
            Code follows the style guide
            Tests added or updated
          template: |
            ## {{summary}}

            {{metadata}}

            {{description}}

            {{criteria}}

            {{attachments}}

            🔗 [{{key}}]({{url}})
            {{checklist}}
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

## Running it by hand

On `workflow_dispatch` there is no pull request in the event payload, so the action looks up the open pull request for the current branch. Pass `pr-number` to point it at a specific one.

## Jira Data Center

The action asks REST API v3 first and retries on v2 when that returns 404, so self-hosted Jira works without any extra configuration. Both versions support `expand=renderedFields`, so the conversion is identical either way.

## Development

```bash
npm install
npm test                      # unit and integration tests
npm run build                 # bundle into dist/ with ncc
cp .env.example .env          # then fill in your Jira details
npm run preview -- ACME-42    # print the body for a real issue, writing nothing
```

`dist/` is committed because GitHub runs the bundled file directly. CI fails if it drifts from the sources, so run `npm run build` before you push.

## License

MIT
