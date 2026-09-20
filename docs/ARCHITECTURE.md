# Architecture at a glance

The Vite/Preact browser app owns contacts and optional local preferences. A Node WebSocket service routes invitation-secret encrypted signaling between two room members. WebRTC provides encrypted voice transport, with relay-only policy by default. A functioning TURN deployment is an operator responsibility.

Tiny messages uses encrypted signaling instead of a media connection. It has bounded retries, deduplication and in-memory expiry, with both peers online. It is not a durable mailbox.

Password-encrypted exports move local contacts between browsers. Deletion removes local copies and does not revoke old invitation secrets. Optional AudioWorklet effects are local and begin off; they are not an anonymity guarantee.

The separate Astro marketing website does not host calls, share the app’s storage origin or collect contact data. It publishes product explanations, guides and media assets. Read the README privacy model before changing any of these boundaries.
