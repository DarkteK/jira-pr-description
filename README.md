# Jira PR Description Sync

A GitHub Action that puts the Jira issue behind a branch into the pull request description, as
Markdown a reviewer can actually read.

Most actions in this space ask Jira for the issue over REST API v2 and paste the description
straight into the body. Jira Cloud stores rich text as Atlassian Document Format, so v2 answers with
**wiki markup**, and GitHub renders that literally. A numbered list of test steps turns into a page
of giant headings, bold text turns into italics, and every link and screenshot disappears.

This action asks Jira to render the issue itself (`expand=renderedFields`) and converts the HTML it
gets back into GitHub-Flavored Markdown. Jira does the interpretation, so ADF, wiki markup, tables,
code blocks and panels all arrive already resolved.

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

## What it does

- Converts headings, bold, italics, ordered and unordered lists, nested lists, tables, code blocks
  (with language), block quotes, status lozenges and horizontal rules.
- Turns Jira info, note, warning and error panels into GitHub alerts.
- Rewrites relative Jira links to absolute ones, and wraps destinations holding parentheses or
  spaces so they survive as links.
- Renders a link whose label is its own URL as an autolink, instead of a wall of escaped
  punctuation from a tracking query string.
- Collects screenshots into a collapsible attachments list. Jira attachment URLs need a signed in
  session, so they are always links, never broken inline images.
- Lifts an "Acceptance criteria" or "Testing steps" section into its own heading, so QA can find it.
- Collapses long descriptions behind a `<details>` block.
- Renders Jira mentions as bold text, so a name in a ticket can never notify an unrelated GitHub
  account.
- Truncates on a line boundary, with a notice, rather than being rejected for exceeding GitHub's
  65536 character body limit.
- Skips the update when nothing changed, so re-runs leave no trace on the timeline.

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

With no `issue` input the key is taken from the branch name, then the pull request title, then its
body. A branch called `acme-42`, `feature/ACME-42` or `ACME-42-fix-divider` all resolve to
`ACME-42`.

### Keep what the author wrote

`mode: block` wraps the Jira content in markers and updates only that region, so notes a developer
adds to the description survive every re-run.

```yaml
        with:
          mode: block
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-token: ${{ secrets.JIRA_API_TOKEN }}
```

### Try it without touching the pull request

`dry-run: true` renders the body into the job summary and stops. Useful the first time you wire it
up, and for testing a template change.

### Change the layout

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

A placeholder with nothing in it disappears along with the blank lines around it, so optional
sections never leave a hole.

### Run it by hand

On `workflow_dispatch` the action looks up the open pull request for the current branch, or takes
`pr-number` if you pass one.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to update the pull request. Needs `pull-requests: write`. |
| `jira-base-url` | required | For example `https://your-org.atlassian.net`. |
| `jira-email` | required | Email of the account that owns the API token. |
| `jira-token` | required | Jira API token. Keep it in a secret. |
| `issue` | detected | Issue key. Detected from the branch, title or body when empty. |
| `issue-pattern` | `([A-Za-z][A-Za-z0-9]+-\d+)` | Detection pattern. The first capture group is the key. |
| `pr-number` | detected | Pull request to update. |
| `mode` | `replace` | `replace` rewrites the body, `block` updates only the marked region. |
| `attachments` | `details` | `details`, `inline` or `off`. |
| `criteria-section` | `true` | Lift acceptance criteria into their own section. |
| `criteria-headings` | see `action.yml` | Comma separated headings that start that section. |
| `collapse-over` | `1500` | Collapse a description longer than this. `0` disables it. |
| `metadata-table` | `false` | Add type, status, priority, assignee, parent and labels. |
| `checklist` | empty | Newline separated checklist items. |
| `template` | built in | Body layout. |
| `fail-on-missing` | `false` | Fail the step when the issue cannot be read, instead of warning. |
| `dry-run` | `false` | Render to the job summary without updating the pull request. |

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

## Jira Data Center

The action asks REST API v3 first and retries on v2 when that returns 404, so self hosted Jira works
without any extra configuration. Both versions support `expand=renderedFields`, so the conversion is
identical either way.

## Permissions and failure behaviour

The default `GITHUB_TOKEN` is enough with `pull-requests: write`. A fine grained personal access
token also works if your organisation restricts the default token.

By default a missing or unreadable issue logs a warning and lets the job pass, because a pull request
without a ticket is a normal thing to have. Set `fail-on-missing: true` if you would rather it stop.

## Development

```bash
npm install
npm test                      # unit tests over HTML fixtures
npm run build                 # bundle into dist/ with ncc
cp .env.example .env          # then fill in your Jira details
npm run preview -- ACME-42    # print the body for a real issue, writing nothing
```

`dist/` is committed because GitHub runs the bundled file directly. CI fails if it drifts from the
sources, so run `npm run build` before you push.

## License

MIT
