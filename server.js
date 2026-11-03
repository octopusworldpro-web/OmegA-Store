const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_UID = String(process.env.STORE_ADMIN_UID || "").trim();
const ADMIN_SECRET = String(process.env.STORE_ADMIN_SECRET || "").trim();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

let commands;
let settings;
const clean = value => String(value == null ? "" : value).trim();
const norm = value => clean(value).toLowerCase();
const publicCommand = doc => {
  if (!doc) return null;
  // Keep _id for the original website detail lookup; also expose a string id.
  return { ...doc, id: String(doc._id) };
};
function parseVersion(value) {
  const raw = clean(value).replace(/^v/i, "");
  const m = raw.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return { core: m[1].split(".").map(Number), pre: m[2] || "" };
}
function compareVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] || 0) - (y.core[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (!x.pre && y.pre) return 1;
  if (x.pre && !y.pre) return -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 0;
  const aa = x.pre.split("."), bb = y.pre.split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] == null) return -1;
    if (bb[i] == null) return 1;
    if (aa[i] === bb[i]) continue;
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i]);
    if (an && bn) return Number(aa[i]) > Number(bb[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}
function adminAllowed(body = {}) {
  const uid = clean(body.senderId || body.userID || body.uploaderID);
  const secret = clean(body.secret);
  return (!!ADMIN_UID && uid === ADMIN_UID) || (!!ADMIN_SECRET && secret === ADMIN_SECRET);
}
function queryFilter(req) {
  const f = {};
  if (req.query.framework) f.framework = clean(req.query.framework);
  if (req.query.kind) f.kind = clean(req.query.kind);
  if (req.query.category) f.category = clean(req.query.category);
  if (req.query.author) f.authorNorm = norm(req.query.author);
  return f;
}
async function findById(id) {
  if (!ObjectId.isValid(String(id))) return null;
  return commands.findOne({ _id: new ObjectId(String(id)) });
}
async function uploadCommand(body) {
  const name = clean(body.name);
  const author = clean(body.author);
  const rawCode = body.rawCode;
  const version = clean(body.version);
  const framework = clean(body.framework || "goat");
  const kind = clean(body.kind || "command");
  if (!name || !author || typeof rawCode !== "string" || !rawCode) {
    return { status: 400, body: { error: "Invalid upload", message: "name, author and rawCode are required." } };
  }
  if (rawCode.length > 500000) return { status: 413, body: { error: "Code too large" } };
  if (!parseVersion(version)) return { status: 400, body: { error: "Invalid version", message: "A valid semantic version is required." } };

  const key = { nameNorm: norm(name), authorNorm: norm(author), framework, kind };
  const existing = await commands.findOne(key);
  const now = new Date();
  const payload = {
    name, nameNorm: key.nameNorm, author, authorNorm: key.authorNorm,
    version, description: clean(body.description), category: clean(body.category) || "Uncategorized",
    rawCode, framework, kind, aliases: Array.isArray(body.aliases) ? body.aliases.map(clean).filter(Boolean) : [],
    updatedAt: now,
    uploadDate: now
  };

  if (!existing) {
    // Prevent duplicate creation if concurrent clients upload the same key.
    try {
      const result = await commands.insertOne({ ...payload, createdAt: now, likes: [], installs: 0 });
      return { status: 201, body: { success: true, id: String(result.insertedId), name, author, version, updated: false, message: "New Store entry created." } };
    } catch (err) {
      if (err.code !== 11000) throw err;
      const raced = await commands.findOne(key);
      if (!raced) throw err;
      return { status: 200, body: { error: "Already exists", id: String(raced._id), currentVersion: raced.version, message: "An entry with this name, author, framework and kind already exists." } };
    }
  }

  const cmp = compareVersion(version, existing.version);
  if (cmp === 0) return { status: 200, body: { error: "Version already exists", sameVersion: true, id: String(existing._id), currentVersion: existing.version, message: `Version ${version} already exists. No duplicate created.` } };
  if (cmp < 0) return { status: 200, body: { error: "Version too low", olderVersion: true, id: String(existing._id), currentVersion: existing.version, message: `Store has v${existing.version}; received v${version}. Older versions are rejected.` } };

  if (body.existingId && String(existing._id) !== String(body.existingId)) {
    return { status: 200, body: { error: "Upload blocked", id: String(existing._id), currentVersion: existing.version, message: "The Store entry ID changed. Refresh and retry." } };
  }
  if (body.expectedVersion && String(body.expectedVersion) !== String(existing.version)) {
    return { status: 200, body: { error: "Upload blocked", id: String(existing._id), currentVersion: existing.version, message: "The Store entry changed during upload. Refresh and retry." } };
  }

  const result = await commands.findOneAndUpdate(
    { _id: existing._id, version: existing.version },
    { $set: payload },
    { returnDocument: "after" }
  );
  const updated = result?.value || result;
  if (!updated || !updated._id) {
    const latest = await commands.findOne({ _id: existing._id });
    return { status: 200, body: { error: "Upload blocked", id: String(existing._id), currentVersion: latest?.version, message: "Another upload updated this entry first." } };
  }
  return { status: 200, body: { success: true, id: String(existing._id), name, author, version, updated: true, message: `Updated existing entry to v${version}.` } };
}

async function startServer() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI environment variable is missing");
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db("omegastore");
  commands = db.collection("commands");
  settings = db.collection("settings");
  // Backfill normalized keys for records created by the legacy /api/commands endpoint.
  const legacy = await commands.find({ $or: [{ nameNorm: { $exists: false } }, { authorNorm: { $exists: false } }] }).toArray();
  for (const doc of legacy) {
    await commands.updateOne({ _id: doc._id }, { $set: {
      nameNorm: norm(doc.name), authorNorm: norm(doc.author),
      framework: clean(doc.framework || "goat"), kind: clean(doc.kind || "command"),
      version: clean(doc.version || "1.0.0"), likes: doc.likes || [], installs: doc.installs || 0,
      likesCount: doc.likesCount || (Array.isArray(doc.likes) ? doc.likes.length : 0)
    } });
  }
  try {
    await commands.createIndex({ nameNorm: 1, authorNorm: 1, framework: 1, kind: 1 }, { unique: true, sparse: true });
  } catch (indexError) {
    console.error("WARNING: Could not enable unique Store-entry index (legacy duplicate records may exist):", indexError.message);
    await commands.createIndex({ nameNorm: 1, authorNorm: 1, framework: 1, kind: 1 });
  }
  await commands.createIndex({ createdAt: -1 });
  await commands.createIndex({ installs: -1, likesCount: -1 });

  app.get("/", (req, res) => res.json({ name: "Omega Store", author: "NirZon", version: "2.0.0", status: "online" }));
  app.get("/health", (req, res) => res.json({ status: "ok", database: "connected" }));

  // Legacy API compatibility
  app.post("/api/commands", async (req, res) => {
    try {
      const result = await uploadCommand(req.body || {});
      return res.status(result.status).json(result.body);
    } catch (e) { console.error("Legacy upload:", e); return res.status(500).json({ error: "Upload failed" }); }
  });
  app.get("/api/commands", async (req, res) => {
    try {
      const filter = {};
      const term = clean(req.query.name || req.query.q || req.query.search);
      if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rx = new RegExp(escaped, "i");
        filter.$or = [
          { name: rx }, { nameNorm: norm(term) },
          { author: rx }, { authorNorm: norm(term) },
          { aliases: rx }
        ];
      }
      if (req.query.author && !term) {
        const escapedAuthor = clean(req.query.author).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
          { author: new RegExp(escapedAuthor, "i") },
          { authorNorm: norm(req.query.author) }
        ];
      }
      if (req.query.framework) filter.framework = clean(req.query.framework);
      if (req.query.kind) filter.kind = clean(req.query.kind);

      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const results = await commands.find(filter, { projection: { rawCode: 0 } })
        .sort({ createdAt: -1, uploadDate: -1 })
        .skip(offset).limit(limit).toArray();

      res.json({
        success: true,
        count: results.length,
        commands: results.map(publicCommand)
      });
    } catch (error) {
      console.error("Search error:", error.message);
      res.status(500).json({ error: "Search failed" });
    }
  });
  app.get("/api/commands/:id", async (req, res) => {
    const doc = await findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Command not found" });
    res.json(publicCommand(doc));
  });

  // GoatStore routes consumed by goatstore.js
  app.post("/miraistore/upload", async (req, res) => {
    try {
      const result = await uploadCommand(req.body || {});
      res.status(result.status).json(result.body);
    } catch (e) { console.error("Upload error:", e); res.status(500).json({ error: "Upload failed", message: "Database upload failed." }); }
  });

  app.get("/miraistore/search", async (req, res) => {
    try {
      const q = clean(req.query.q);
      if (ObjectId.isValid(q)) {
        const doc = await findById(q);
        if (doc) return res.json(publicCommand(doc));
      }
      const f = queryFilter(req);
      let cursor = commands.find(f);
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        cursor = commands.find({ ...f, $or: [{ name: rx }, { nameNorm: norm(q) }, { author: rx }, { authorNorm: norm(q) }, { aliases: rx }] });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const docs = await cursor.sort({ createdAt: -1 }).skip(offset).limit(limit).toArray();
      res.json({ success: true, count: docs.length, total: await commands.countDocuments(q ? { ...f, $or: [{ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }, { aliases: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }] } : f), commands: docs.map(publicCommand) });
    } catch (e) { console.error("Search error:", e); res.status(500).json({ error: "Search failed", message: e.message }); }
  });

  app.get("/miraistore/list", async (req, res) => {
    try {
      const f = queryFilter(req);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const [docs, total] = await Promise.all([
        commands.find(f).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
        commands.countDocuments(f)
      ]);
      res.json({ success: true, total, commands: docs.map(publicCommand) });
    } catch (e) { res.status(500).json({ error: "List failed" }); }
  });

  app.get("/miraistore/trending", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
    const docs = await commands.find({}).sort({ installs: -1, likesCount: -1, createdAt: -1 }).limit(limit).toArray();
    res.json({ success: true, commands: docs.map(publicCommand) });
  });

  app.get("/miraistore/premium", async (req, res) => {
    const doc = await settings.findOne({ _id: "premium" });
    res.json({ adminUid: ADMIN_UID || null, premiumUsers: doc?.premiumUsers || [], premiumCommands: doc?.premiumCommands || [], premiumAuthors: doc?.premiumAuthors || [] });
  });
  app.post("/miraistore/premium", async (req, res) => {
    if (!ADMIN_UID || clean(req.body?.senderId) !== ADMIN_UID) return res.status(403).json({ error: "Not allowed" });
    const { action, value } = req.body || {};
    const doc = await settings.findOne({ _id: "premium" }) || { premiumUsers: [], premiumCommands: [], premiumAuthors: [] };
    const map = { addUser: "premiumUsers", removeUser: "premiumUsers", addCommand: "premiumCommands", removeCommand: "premiumCommands", addAuthor: "premiumAuthors", removeAuthor: "premiumAuthors" };
    const field = map[action];
    if (!field || !clean(value)) return res.status(400).json({ error: "Invalid premium action" });
    let arr = doc[field] || [];
    if (action.startsWith("add")) { if (!arr.includes(clean(value))) arr.push(clean(value)); }
    else arr = arr.filter(v => norm(v) !== norm(value));
    await settings.updateOne({ _id: "premium" }, { $set: { [field]: arr } }, { upsert: true });
    const latest = await settings.findOne({ _id: "premium" });
    res.json({ ok: true, adminUid: ADMIN_UID, premiumUsers: latest.premiumUsers || [], premiumCommands: latest.premiumCommands || [], premiumAuthors: latest.premiumAuthors || [] });
  });

  app.get("/miraistore/ratelimit/status", (req, res) => res.json({ blocked: false, remaining: 0 }));

  app.post("/miraistore/install/:id", async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid command ID" });
      await commands.updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { installs: 1 } });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Install tracking failed" }); }
  });

  app.post("/miraistore/like/:id", async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid command ID" });
      const uid = clean(req.body?.userID || req.body?.clientFp);
      if (!uid) return res.status(400).json({ error: "User ID required" });
      const doc = await commands.findOne({ _id: new ObjectId(req.params.id) });
      if (!doc) return res.status(404).json({ error: "Command not found" });
      if ((doc.likes || []).includes(uid)) return res.json({ message: "Already liked", likes: (doc.likes || []).length });
      await commands.updateOne({ _id: doc._id }, { $addToSet: { likes: uid }, $inc: { likesCount: 1 } });
      const latest = await commands.findOne({ _id: doc._id });
      res.json({ success: true, likes: latest.likesCount || 0 });
    } catch (e) { res.status(500).json({ error: "Like failed" }); }
  });

  app.post("/miraistore/delete/:id", async (req, res) => {
    try {
      if (!adminAllowed(req.body)) return res.status(403).json({ error: "Not allowed", message: "Configure STORE_ADMIN_UID or STORE_ADMIN_SECRET on the API host." });
      if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid command ID" });
      const result = await commands.deleteOne({ _id: new ObjectId(req.params.id) });
      if (!result.deletedCount) return res.status(404).json({ error: "Command not found" });
      res.json({ success: true, id: req.params.id });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
  });

  app.listen(PORT, "0.0.0.0", () => console.log(`Omega Store API running on port ${PORT}`));
}
startServer().catch(error => { console.error("Startup failed:", error.message); process.exit(1); });
