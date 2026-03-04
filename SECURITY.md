# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Engram, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email **security@angelopvtac.dev** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive an acknowledgment within 48 hours
4. A fix will be developed and released as a patch version

## Scope

Engram stores agent memory in local SQLite databases. Security considerations include:

- **Data at rest**: Memory databases are unencrypted SQLite files. Protect file-system access accordingly.
- **GDPR erasure**: The `gdpr` forgetting policy purges all tiers, quarantine, and working memory for a target entity. Verify erasure completeness for your compliance requirements.
- **Write rate limiting**: IntegrityGuard blocks excessive writes (>2x threshold) as potential memory poisoning. Tune thresholds for your workload.
- **Input validation**: Engram does not sanitize memory content. If you store user-provided data, sanitize before storing.

## Dependencies

Engram has 2 runtime dependencies:

- `better-sqlite3` -- native SQLite bindings
- `commander` -- CLI argument parsing

Both are actively maintained. Run `npm audit` to check for known vulnerabilities.
