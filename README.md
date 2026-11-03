# OmegA Store API

OmegA Store API for the GoatBot module.

## Deploy

1. Deploy this folder to your Node.js host.
2. Set these environment variables in your hosting service:
   - `MONGO_URI` — MongoDB connection string (required).
   - `OWNER_UID` — Facebook UID of the store owner/admin (required).
   - `PORT` — optional; most hosts set this automatically.
3. Install dependencies with `npm install` and start with `npm start`.

The server connects specifically to the MongoDB database named `OmegAstore`.
Keep your MongoDB connection string private. Do not put it in the public repository.

## GoatStore compatibility

Implements `/miraistore/*` routes used by the GoatStore command:
- Upload with semantic version enforcement.
- Existing entry is updated only when the incoming version is newer.
- Same or older versions are rejected; entry ID is retained.
- Search, list, trending, install tracking, likes, Premium settings and delete.

## Version policy

Entries are identified by normalized `name + author + framework + kind`.
A newer version updates the existing MongoDB document, preserving its `_id`.
Same and older versions never create a second entry.

Before deploying over a populated database, take a MongoDB backup. Existing collections in other databases are not modified by this server.
