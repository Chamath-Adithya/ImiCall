# Before a release or a larger launch

## Rights and source

- Confirm the intended license grant and the rights to all original material being licensed. Git authorship alone is not proof of ownership or employment/IP clearance.
- Keep the standard license text unmodified. Preserve dependency notices and contributor attribution.
- Audit current files and full Git history for secrets and old personal data. Rotating a credential is separate from rewriting history; do not rewrite shared history without a coordinated plan.
- Enable a private vulnerability-reporting channel and document who monitors it.
- Provide a visible source/license link in the app. Publish the corresponding source for the actual deployed version, including modifications and required build information. Keep release tags and deployment records aligned. A link to an unrelated or stale upstream tree is not enough.
- For downstream deployments, set their source link to the actual fork/version and check the applicable license obligations.

## Reproducibility

- Clean checkout, Node 24, npm ci, npm run build, npm test.
- Build before the server integration tests, which exercise dist assets.
- Run the relevant browser scripts and record whether conditions are simulated or real.
- Test microphone/audio on physical Apple and Android devices and complete an actual relay-only call.
- Review dependencies and the shipped third-party notices. A successful build is not a security audit.

## Public claims and operations

- Verify app.imicall.com and imicall.com over HTTPS, with the real domain allowlist and no stale tunnel URL.
- Configure TURN quotas, fresh VAPID keys, abuse controls and infrastructure retention.
- Do not claim irreversible voice anonymity, total untraceability, universal 2G success or an independent audit without evidence.
- Check repository license detection, README links, issue templates and CI.
- Describe source rights and any paid service as separate things. Publish real pricing/terms only after there is an actual offering.
