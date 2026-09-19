# Security policy

## Report privately

Do not publish exploit details, invitation secrets, recordings, credentials or user data in public issues.

After the repository is public, use GitHub private vulnerability reporting in the Security tab if the maintainer has enabled it. If unavailable, ask the maintainer to establish a private reporting channel without disclosing the vulnerability itself. No dedicated security inbox, service-level response time or bug bounty has been established.

Include the affected version, a minimal synthetic reproduction, expected impact and any proposed fix. Never test against other users or production infrastructure without authorization.

## Scope and limits

ImiCall uses invitation-secret encrypted signaling and WebRTC encrypted media. Its custom signaling protocol has not received an independent cryptographic audit. No promise of total anonymity, forward secrecy, forensic erasure or unhackability is made.

Contacts in regular mode remain in browser-local storage. A compromised browser, application host or participant can undermine privacy. Network/hosting/relay metadata may exist outside the application. The README describes relay requirements and temporary-session limits.

## Before public release

Review current files and the full Git history for secrets and historical data. Previous versions included hardcoded push keys and legacy subscription files. Rotate affected secrets and review historical commits before changing repository visibility. Ignoring or deleting a file in the latest commit does not remove old copies.

Enable private vulnerability reporting, choose a source license, keep dependencies current and verify real HTTPS/TURN behavior. A clean dependency audit is not an application security audit.
