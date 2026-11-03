# OmegA Store API

OmegA Store API for the GoatStore module.

## Deploy

1. Deploy this folder to your Node.js host.
2. Set these environment variables:
   - `MONGODB_URI` — MongoDB connection string (required).
   - `STORE_ADMIN_UID` — Facebook UID allowed to manage Premium and delete entries.
   - `STORE_ADMIN_SECRET` — optional secret for delete requests.
   - `PORT` — optional; most hosts set this automatically.
3. Install dependencies with `npm install` and start with `npm start`.

Keep `STORE_ADMIN_SECRET` private. Do not put it in the public repository or inside `goatstore.js`.

## GoatStore compatibility

Implements `/miraistore/*` routes used by GoatStore:
- Upload with semantic version enforcement.
- Existing entry is overwritten only when the incoming version is newer.
- Same or older versions are rejected; entry ID is retained.
- Search, list, trending, install tracking, likes, Premium settings and delete.
- Self-update lookup works through `/miraistore/search`.

The API also retains the legacy `/api/commands` endpoints.

## Version policy

Entries are identified by normalized `name + author + framework + kind`.
A newer version updates the existing MongoDB document, preserving its `_id`.
Same and older versions never create a second entry.

Before deploying over a populated database, take a MongoDB backup. The server backfills normalized fields for legacy records. If duplicate legacy entries already exist, MongoDB may refuse the unique compound index; the API logs a warning and continues with a non-unique index, so clean those duplicate records to restore database-enforced uniqueness.


## Website compatibility
The original `index.html` is retained unchanged. The API keeps `_id` in command responses for the website detail view and supports searching by command name, author, and aliases.
