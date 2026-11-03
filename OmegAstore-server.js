
// OmegA Store - Public GoatBot API
// Owner: NirZon

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const OWNER_UID = String(process.env.OWNER_UID || "").trim();

if (!MONGO_URI || !OWNER_UID) {
  console.error("MONGO_URI or OWNER_UID is missing!");
  process.exit(1);
}

// ---------------- DATABASE ----------------

mongoose.connect(MONGO_URI, { dbName: "OmegAstore" })
  .then(() => console.log("[OmegA Store] MongoDB connected"))
  .catch(err => {
    console.error("[OmegA Store] MongoDB error:", err.message);
    process.exit(1);
  });

const CommandSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  nameKey: { type: String, index: true },
  author: { type: String, default: "Unknown" },
  authorKey: { type: String, index: true },
  version: { type: String, default: "N/A" },
  category: { type: String, default: "Uncategorized" },
  description: { type: String, default: "" },
  framework: { type: String, default: "goat", index: true },
  kind: { type: String, default: "command", index: true },
  rawCode: { type: String, required: true },
  uploaderID: { type: String, default: "" },
  uploadDate: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  likedBy: { type: [String], default: [] },
  installedBy: { type: [String], default: [] }
}, { timestamps: true });

const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});

const PremiumSchema = new mongoose.Schema({
  premiumUsers: { type: [String], default: [] },
  premiumCommands: { type: [String], default: [] },
  premiumAuthors: { type: [String], default: [] }
});

const Command = mongoose.model("GoatstoreCommand", CommandSchema);
const Counter = mongoose.model("GoatstoreCounter", CounterSchema);
const Premium = mongoose.model("GoatstorePremium", PremiumSchema);

// ---------------- HELPERS ----------------

const norm = v => String(v ?? "").trim().toLowerCase();
const clean = v => String(v ?? "").trim();

function isOwner(uid) {
  return clean(uid) === OWNER_UID;
}

function compareVersions(a, b) {
  const x = String(a).split(".").map(v => parseInt(v) || 0);
  const y = String(b).split(".").map(v => parseInt(v) || 0);

  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getPremium() {
  let p = await Premium.findOne();
  if (!p) p = await Premium.create({});
  return p;
}

async function nextID() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "commands" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return String(counter.seq);
}

function publicCommand(cmd) {
  return {
    id: cmd.id,
    name: cmd.name,
    author: cmd.author,
    version: cmd.version,
    category: cmd.category,
    description: cmd.description,
    framework: cmd.framework,
    kind: cmd.kind,
    rawCode: cmd.rawCode,
    rawUrl: "",
    uploadDate: cmd.uploadDate,
    views: cmd.views,
    likes: cmd.likes,
    installs: cmd.installs
  };
}

function extractCodeInfo(code) {
  const get = (key, fallback) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = code.match(
      new RegExp("\\b" + escaped + "\\s*:\\s*[\"'`]([^\"'`]*)[\"'`]")
    );
    return match?.[1] || fallback;
  };

  return {
    name: get("name", ""),
    author: get("author", get("credits", "Unknown")),
    version: get("version", "N/A"),
    category: get("category", "Uncategorized"),
    description: get("shortDescription", "")
  };
}

// ---------------- HOME ----------------

app.get("/", (req, res) => {
  res.json({
    name: "OmegA Store",
    owner: "NirZon",
    status: "online",
    version: "1.0.0",
    message: "Welcome to OmegA Public GoatStore"
  });
});

// ---------------- PREMIUM ----------------

app.get("/miraistore/premium", async (req, res) => {
  try {
    const p = await getPremium();

    res.json({
      adminUid: OWNER_UID,
      premiumUsers: p.premiumUsers,
      premiumCommands: p.premiumCommands,
      premiumAuthors: p.premiumAuthors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/miraistore/premium", async (req, res) => {
  try {
    const { senderId, action, value } = req.body;

    if (!isOwner(senderId)) {
      return res.status(403).json({ error: "Store admin only." });
    }

    const p = await getPremium();
    const v = clean(value);
    const n = norm(value);

    if (!v) return res.status(400).json({ error: "Value required." });

    switch (action) {
      case "addUser":
        if (v === OWNER_UID) {
          return res.status(400).json({ error: "Owner is already premium." });
        }
        if (!p.premiumUsers.includes(v)) p.premiumUsers.push(v);
        break;

      case "removeUser":
        p.premiumUsers = p.premiumUsers.filter(x => x !== v);
        break;

      case "addCommand":
        if (!p.premiumCommands.includes(n)) p.premiumCommands.push(n);
        break;

      case "removeCommand":
        p.premiumCommands = p.premiumCommands.filter(x => x !== n);
        break;

      case "addAuthor":
        if (!p.premiumAuthors.includes(n)) p.premiumAuthors.push(n);
        break;

      case "removeAuthor":
        p.premiumAuthors = p.premiumAuthors.filter(x => x !== n);
        break;

      default:
        return res.status(400).json({ error: "Unknown action." });
    }

    await p.save();

    res.json({
      ok: true,
      adminUid: OWNER_UID,
      premiumUsers: p.premiumUsers,
      premiumCommands: p.premiumCommands,
      premiumAuthors: p.premiumAuthors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- ABUSE GUARD ----------------

app.get("/miraistore/ratelimit/status", async (req, res) => {
  try {
    // Compatible with the original Goatstore command.
    res.json({ blocked: false });
  } catch (_) {
    res.json({ blocked: false });
  }
});

// ---------------- SEARCH ----------------

app.get("/miraistore/search", async (req, res) => {
  try {
    const {
      q = "",
      author,
      framework,
      kind,
      category
    } = req.query;

    const query = clean(q);

    // Numeric Store ID
    if (/^\d+$/.test(query)) {
      const found = await Command.findOne({ id: query });

      if (!found) {
        return res.status(404).json({ message: "Command not found." });
      }

      found.views++;
      await found.save();

      return res.json(publicCommand(found));
    }

    const filter = {};

    if (author) {
      filter.authorKey = new RegExp(escapeRegex(norm(author)), "i");
    } else if (query) {
      const regex = new RegExp(escapeRegex(query), "i");
      filter.$or = [
        { name: regex },
        { author: regex },
        { category: regex },
        { description: regex }
      ];
    }

    if (framework) filter.framework = norm(framework);
    if (kind) filter.kind = norm(kind);

    if (category) {
      filter.category = new RegExp(escapeRegex(category), "i");
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 5, 1), 50
    );

    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const [commands, total] = await Promise.all([
      Command.find(filter)
        .sort({ uploadDate: -1 })
        .skip(offset)
        .limit(limit),
      Command.countDocuments(filter)
    ]);

    res.json({
      commands: commands.map(publicCommand),
      total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- LIST ----------------

app.get("/miraistore/list", async (req, res) => {
  try {
    const filter = {};

    if (req.query.framework) {
      filter.framework = norm(req.query.framework);
    }

    if (req.query.kind) {
      filter.kind = norm(req.query.kind);
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 10, 1), 50
    );

    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const [commands, total] = await Promise.all([
      Command.find(filter)
        .sort({ uploadDate: -1 })
        .skip(offset)
        .limit(limit),
      Command.countDocuments(filter)
    ]);

    res.json({
      commands: commands.map(publicCommand),
      total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- TRENDING ----------------

app.get("/miraistore/trending", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 5, 1), 50
    );

    const commands = await Command.find()
      .sort({ likes: -1, views: -1 })
      .limit(limit);

    res.json({
      commands: commands.map(publicCommand)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- UPLOAD ----------------

app.post("/miraistore/upload", async (req, res) => {
  try {
    const {
      rawCode,
      framework = "goat",
      kind = "command",
      uploaderID = "",
      clientFp = "",
      author: suppliedAuthor,
      category: suppliedCategory
    } = req.body;

    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return res.status(400).json({ error: "rawCode is required." });
    }

    if (rawCode.length > 500000) {
      return res.status(413).json({ error: "File too large." });
    }

    if (norm(framework) !== "goat") {
      return res.status(400).json({
        error: "Only GoatBot files are accepted."
      });
    }

    if (!["command", "event"].includes(norm(kind))) {
      return res.status(400).json({ error: "Invalid file kind." });
    }

    const info = extractCodeInfo(rawCode);

    if (!info.name) {
      return res.status(400).json({
        error: "Command name not found in source code."
      });
    }

    const author = clean(suppliedAuthor || info.author || "Unknown");
    const category = clean(suppliedCategory || info.category);
    const uploader = clean(uploaderID || clientFp);

    const existing = await Command.findOne({
      nameKey: norm(info.name),
      authorKey: norm(author),
      framework: "goat",
      kind: norm(kind)
    });

    if (existing) {
      const comparison = compareVersions(info.version, existing.version);

      if (comparison <= 0) {
        return res.status(409).json({
          error: comparison === 0
            ? "Version already exists"
            : "Version too low",
          id: existing.id,
          currentVersion: existing.version,
          message: "Upload a higher version to update this entry."
        });
      }

      existing.rawCode = rawCode;
      existing.version = info.version;
      existing.category = category;
      existing.description = info.description;
      existing.uploadDate = new Date();

      if (uploader) existing.uploaderID = uploader;

      await existing.save();

      return res.json({
        ok: true,
        updated: true,
        id: existing.id,
        type: `goat-${kind}`,
        message: "Existing command updated."
      });
    }

    const id = await nextID();

    const command = await Command.create({
      id,
      name: info.name,
      nameKey: norm(info.name),
      author,
      authorKey: norm(author),
      version: info.version,
      category,
      description: info.description,
      framework: "goat",
      kind: norm(kind),
      rawCode,
      uploaderID: uploader
    });

    res.json({
      ok: true,
      id: command.id,
      type: `goat-${kind}`,
      message: "Upload successful."
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- INSTALL ----------------

app.post("/miraistore/install/:id", async (req, res) => {
  try {
    const command = await Command.findOne({ id: clean(req.params.id) });

    if (!command) {
      return res.status(404).json({ error: "Command not found." });
    }

    const clientFp = clean(req.body.clientFp);

    if (clientFp && !command.installedBy.includes(clientFp)) {
      command.installedBy.push(clientFp);
      command.installs++;
      await command.save();
    }

    res.json({
      ok: true,
      installs: command.installs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- LIKE ----------------

app.post("/miraistore/like/:id", async (req, res) => {
  try {
    const command = await Command.findOne({ id: clean(req.params.id) });

    if (!command) {
      return res.status(404).json({ error: "Command not found." });
    }

    const userID = clean(req.body.userID || req.body.clientFp);

    if (!userID) {
      return res.status(400).json({ error: "User ID required." });
    }

    if (command.likedBy.includes(userID)) {
      return res.json({
        message: "Already liked.",
        likes: command.likes
      });
    }

    command.likedBy.push(userID);
    command.likes++;

    await command.save();

    res.json({
      ok: true,
      likes: command.likes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- DELETE ----------------

app.post("/miraistore/delete/:id", async (req, res) => {
  try {
    const command = await Command.findOne({ id: clean(req.params.id) });

    if (!command) {
      return res.status(404).json({ error: "Command not found." });
    }

    const userID = clean(req.body.userID);

    const allowed =
      isOwner(userID) ||
      (!!command.uploaderID && command.uploaderID === userID);

    if (!allowed) {
      return res.status(403).json({
        error: "Not authorized to delete this file."
      });
    }

    await Command.deleteOne({ _id: command._id });

    res.json({
      ok: true,
      message: "Deleted.",
      id: command.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- ERROR HANDLER ----------------

app.use((req, res) => {
  res.status(404).json({
    error: "OmegA Store API route not found."
  });
});

app.listen(PORT, () => {
  console.log(`[OmegA Store] API running on port ${PORT}`);
});
