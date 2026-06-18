# Security Policy

## Supported versions

Security fixes are applied to the latest published version of the extension.

## Reporting a vulnerability

Do not open public GitHub issues for sensitive vulnerabilities.

Report security issues privately through one of these channels:

- GitHub security advisories for this repository
- the maintainer contact listed on [https://mikesoft.it](https://mikesoft.it)

Include:

- affected version
- reproduction steps
- impact summary
- any proposed mitigation, if available

## Sensitive data handling

Never include API keys, account secrets, or unredacted private payloads in public reports.

When sharing payloads for debugging, redact sensitive values while keeping field names and structure where possible. The extension stores the Chutes API key in VS Code SecretStorage and never writes it to settings or logs.
