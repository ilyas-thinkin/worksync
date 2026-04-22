Put tracked deployment env files here for the system update job.

Example:
- `deploy/env/backend.env` -> copied to `backend/.env` during update and rollback

`backend.env` is now part of the automatic update path and is required by
[deploy/system-update.config.js](/home/worksync/worksync/deploy/system-update.config.js).
