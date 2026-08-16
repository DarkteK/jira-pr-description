# Jira PR Description Sync

A GitHub Action that puts the Jira issue behind a branch into the pull request description, as Markdown a reviewer can actually read.

Most actions in this space ask Jira for the issue over REST API v2 and paste the result straight into the body. Jira Cloud stores rich text as Atlassian Document Format, so v2 answers with **wiki markup**, and GitHub renders that literally: a numbered list of test steps turns into a page of giant headings, bold text turns into italics, and links and screenshots disappear.

This action asks Jira to render the issue itself (`expand=renderedFields`) and converts the HTML it gets back into GitHub-Flavored Markdown. Jira does the interpretation, so ADF, wiki markup, tables, code blocks and panels all arrive already resolved. Self-hosted Jira works too: the action tries REST API v3 and falls back to v2.

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

Three secrets and you are done. The issue key is read from the branch name.

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

Everything else has a default. This is the same step with every option written out, so you can delete the lines you do not need:

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}

          github-token: ${{ github.token }}                      # optional
          issue: ACME-42                                         # optional, detected from the branch
          issue-pattern: '([A-Za-z][A-Za-z0-9]+-\d+)'            # optional
          pr-number: 42                                          # optional, detected from the event
          mode: replace                                          # optional, replace or block
          attachments: details                                   # optional, details, inline or off
          criteria-section: true                                 # optional
          criteria-headings: 'acceptance criteria,testing steps'  # optional
          collapse-over: 1500                                    # optional, 0 never collapses
          metadata-table: false                                  # optional
          checklist: ''                                          # optional
          template: ''                                           # optional
          fail-on-missing: false                                 # optional
          dry-run: false                                         # optional
```

### Passing the issue key yourself

With `issue` left out, the key is taken from the branch name, then the pull request title, then its body. Branches called `acme-42`, `feature/ACME-42` and `ACME-42-fix-divider` all resolve to `ACME-42`.

Set it explicitly when the key is nowhere in those places, or when an earlier job already worked it out:

```yaml
        with:
          issue: ACME-42
          # or from a previous job:
          # issue: ${{ needs.jira-issue-info.outputs.JIRA_TICKET }}
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

If your keys just follow a different shape, leave `issue` alone and change `issue-pattern` instead. Its first capture group is the key, for example `'(DEV_[0-9]+)'`.

## First time testing this action

Turn on `dry-run` for the first run. The action renders the exact body it would write into the workflow's job summary and stops there, leaving the pull request untouched:

```yaml
      - uses: DarkteK/jira-pr-description@v1
        with:
          dry-run: true
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

Open the run in the **Actions** tab and read the summary at the top of the job. When it looks right, delete the `dry-run` line.

One thing that surprises people: if you store the Jira URL as a secret, every Jira link in that summary shows as `***`. That is GitHub redacting the secret in its own logs, not the action mangling the output. Bodies written to the pull request go over the API and are never redacted.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `jira-base-url` | **required** | Your Jira URL, for example `https://your-org.atlassian.net`. |
| `jira-email` | **required** | Email of the account that owns the API token. |
| `jira-token` | **required** | Jira API token. See below. |
| `github-token` | `${{ github.token }}` | Token used to update the pull request. Needs `pull-requests: write`. |
| `issue` | detected | Issue key. Read from the branch, title or body when empty. |
| `issue-pattern` | `([A-Za-z][A-Za-z0-9]+-\d+)` | Detection pattern. The first capture group is the key. |
| `pr-number` | detected | Which pull request to update. See below. |
| `mode` | `replace` | `replace` or `block`. See below. |
| `attachments` | `details` | `details`, `inline` or `off`. |
| `criteria-section` | `true` | Lift acceptance criteria into their own heading. |
| `criteria-headings` | `acceptance criteria,testing steps,test steps,steps to test,qa steps,how to test` | Comma separated headings that start that section. |
| `collapse-over` | `1500` | Collapse a description longer than this. `0` disables it. |
| `metadata-table` | `false` | Add issue type, status, priority, assignee, parent and labels. |
| `checklist` | empty | Newline separated checklist items. |
| `template` | built in | Body layout. See below. |
| `fail-on-missing` | `false` | Fail the step when the issue cannot be read. See below. |
| `dry-run` | `false` | Render to the job summary without updating the pull request. |

The rest of this section covers the six that need more than a line.

### `jira-token`

A Jira API token, not an account password.

1. Sign in as the account you want the action to read Jira with, and open <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Choose **Create API token**, label it something like `github-actions`, and copy the value. Atlassian shows it once.
3. Save it as a repository secret, for example `JIRA_API_TOKEN`, and pass it as `jira-token`.

The account needs permission to view the issues you want to read, which is **Browse Projects** on the relevant project. That is the same permission the REST API's *Get issue* endpoint checks. A read-only service account is enough; nothing here ever writes to Jira.

Pair it with `jira-email`, the address of the account that created the token. The two are combined into a Basic auth header, so they must belong to the same account.

### `pr-number`

On a `pull_request` event the pull request comes from the payload and you can ignore this.

On any other event, including `workflow_dispatch`, the action looks up the open pull request for the current branch. Set `pr-number` to point it at a specific one instead.

### `mode`

**`replace`** (default) rewrites the whole description on every run.

**`block`** wraps the output in markers and touches only that region, so notes a developer added to the description survive:

```yaml
        with:
          mode: block
```

The body then looks like this, and only the marked part is ever rewritten:

```markdown
<!-- jira-sync:start -->
## [ACME-42](https://your-org.atlassian.net/browse/ACME-42) Divider ignores the theme
...
<!-- jira-sync:end -->

Anything written here by hand, including pasted screenshots, is left alone.
```

This matters when the action runs on more than the `opened` event. On `opened` alone there is nothing to protect yet, so `replace` is safe.

### `template`

Controls the whole layout. These placeholders are available, and one with nothing in it disappears along with the blank lines around it, so optional sections never leave a hole:

| Placeholder | Content |
| --- | --- |
| `{{key}}` | Issue key, for example `ACME-42`. |
| `{{summary}}` | Issue summary. |
| `{{url}}` | Browse URL of the issue. |
| `{{description}}` | The converted description, collapsed if it is long. |
| `{{criteria}}` | The acceptance criteria section. |
| `{{attachments}}` | The attachments list. |
| `{{metadata}}` | The metadata table, when `metadata-table` is on. |
| `{{checklist}}` | The checklist, when `checklist` is set. |

```yaml
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
```

The same values are also published as step outputs, for later steps in the same job:

| Output | Content |
| --- | --- |
| `issue-key` | The key that was used. |
| `issue-url` | Browse URL of the issue. |
| `summary` | Issue summary. |
| `status` | Status name. |
| `assignee` | Assignee display name. |
| `markdown` | The generated Markdown. |
| `updated` | `true` when the body was changed. |

```yaml
      - uses: DarkteK/jira-pr-description@v1
        id: jira
      - run: echo "${{ steps.jira.outputs.issue-key }} is ${{ steps.jira.outputs.status }}"
```

### `fail-on-missing`

By default a missing or unreadable issue logs a warning and lets the job pass, because a pull request without a ticket is a normal thing to have. Set it to `true` to fail the step instead.

The messages say which of the two it was, so a misconfiguration does not look like a missing ticket: `401` points at `jira-email` and `jira-token`, `403` at the account's permissions, and `404` at the key or `jira-base-url`.

## Development

```bash
npm install
npm test                      # unit and integration tests
npm run build                 # bundle into dist/ with ncc
cp .env.example .env          # then fill in your Jira details
npm run preview -- ACME-42    # print the body for a real issue, writing nothing
```

`dist/` is committed because GitHub runs the bundled file directly. CI fails if it drifts from the sources, so run `npm run build` before you push.
