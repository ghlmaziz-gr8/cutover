# Discovery engine (v0.1)

Reads an application and writes structured findings plus a readable report.
Standard library only: Python 3.9+ and git are the only requirements.

## Run it

Analyze a GitHub repository:

    python3 engine/cutover_discover.py --repo owner/name --ref main --out reports

For a private repository, set a token in the environment first. Never put it in the URL:

    export GITHUB_TOKEN=...   # a fine-grained, read-only token for that repository
    python3 engine/cutover_discover.py --repo owner/private-name --out reports

Analyze a folder that is already on disk:

    python3 engine/cutover_discover.py --path ./some-app --out reports

Each run writes `reports/<name>/findings.json` (for the portal) and
`reports/<name>/report.md` (for people to read).

## What it reports

- **Age and history:** first and last commit, total commits, release tags per year (git only)
- **Stack:** languages, Spring Boot and Java versions, starters, database engines, frontend packages
- **Data model:** tables from SQL scripts, migration tool, JPA entities
- **User interface and portal:** controllers, endpoint annotations, screen templates, likely client-facing status
- **Roles and access:** role names from authorization annotations
- **Epic integration:** FHIR versions and endpoints, Epic-specific hosts, SMART or backend-auth signals, HL7 message types
- **Privacy:** files that contain HL7 patient identifier (PID) segments. Values are never recorded.
- **Containers, delivery, infrastructure:** image references and pinning, CI pipelines, infrastructure-as-code files

Every finding has a confidence label:
- **verified** means the value was found directly in a file. The evidence lists those files.
- **inferred** means a heuristic. A person should confirm it.

## Safety rules built into the code

- The source is read and never modified. Clones go to a temporary folder that is deleted afterwards.
- Tokens are sent to git as an HTTP header. They never appear in output or error messages.
- Patient identifier values are never written to output. Only file paths and counts are recorded.
- Nothing is built, executed, or connected to.

## Tests

    python3 -m unittest engine/test_discover.py

The tests run the engine against `fixtures/synthetic-epic-app` and compare every result with its
answer key, `EXPECTED.json`. They also check that no patient identifier appears in the output.

## Known limits

These are also written into every report under "Limitations":
- Route annotations are counted but not joined with class-level prefixes.
- Screens are counted from template and page files, so fragments are included.
- Roles that exist only in an identity provider or database are not visible.
- Live cloud infrastructure is not inventoried. That needs the read-only role or the inventory script.
- Runtime versions are not checked against vendor end-of-support dates yet.
