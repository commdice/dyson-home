# Map

The index for this second brain. Every piece of information has exactly one
home. Check here before you store something and before you answer a question.

## Where each type of information lives

| Type of information | Lives in | Example |
|---|---|---|
| Lasting facts: preferences, setup, standing context, things to always remember | `memory.md` | "Shop runs T21 on Windows Server" |
| Lessons: what worked, what didn't, and why | `lessons.md` | "Test Meraki VPN from off-site before handing over" |
| Decisions: what was decided, when, why, alternatives considered | `decisions.md` | "Chose Telstra eSIM over physical SIMs" |
| A topic, reference or how-to (one topic per file) | `notes/<topic>.md` | `notes/meraki-client-vpn.md` |
| A person: role, contact, context, history (one person per file) | `people/<first-last>.md` | `people/jane-smith.md` |
| A project: goal, status, next steps, links (one project per file) | `projects/<project-name>.md` | `projects/t21-server-migration.md` |

Each folder holds a `_template.md` to copy when starting a new file.

## Rules

1. **One topic per file.** If a file starts covering two things, split it.
2. **File names use lowercase words joined by hyphens:** `paint-booth-maintenance.md`.
   No spaces, capitals or underscores (the `_template.md` files are the only exception).
3. **Storing something new:** find its type in the table above and put it there.
   If it doesn't fit any type, add a row to this map first, then store it.
4. **Answering a question:**
   - Read this map, then open only the files it points to.
   - Name the source file in the answer, e.g. *(source: `second-brain/people/jane-smith.md`)*.
   - If the answer isn't in these files, say so plainly ("That isn't in the second
     brain") and don't guess or fill gaps from general knowledge.
5. **Link across files** with relative paths, e.g. `[Jane](people/jane-smith.md)`, rather
   than copying the same information into two places.
