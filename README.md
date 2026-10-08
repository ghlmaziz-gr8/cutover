# Cutover

Cutover is a planning and migration platform for hospitals and provider groups. It reads a customer's application code, data structures and infrastructure, then drafts a migration plan for review before anything changes.

## Folders

- `docs/`: the public demo site, served by GitHub Pages at https://cutover.site. Uses synthetic data only.
- `engine/`: the discovery engine (command-line tool). Added in a later step.
- `fixtures/`: test applications and synthetic HL7 messages. Contains no real patient data.
- `planning/`: internal notes, the answer key for discovery testing, and trademark notes.

## Rules for this repo

- No real patient data, hospital credentials or production identifiers, in any folder.
- Never commit cloud keys, tokens or Terraform state files.
