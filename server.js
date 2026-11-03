const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

let commands;

async function startServer() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is missing");
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db("omegastore");
  commands = db.collection("commands");
  await commands.createIndex({ name: 1 });
  await commands.createIndex({ author: 1 });

  app.get("/", (req, res) => {
    res.json({
      name: "Omega Store",
      author: "NirZon",
      version: "1.0.0",
      status: "online"
    });
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok", database: "connected" });
  });

  app.post("/api/commands", async (req, res) => {
    try {
      const { name, author, version, description, rawCode, framework, kind } = req.body;

      if (!name || !author || !rawCode) {
        return res.status(400).json({
          error: "name, author and rawCode are required"
        });
      }

      if (typeof rawCode !== "string" || rawCode.length > 500000) {
        return res.status(400).json({ error: "Invalid or oversized rawCode" });
      }

      const command = {
        name: String(name).trim(),
        author: String(author).trim(),
        version: String(version || "1.0.0"),
        description: String(description || ""),
        rawCode,
        framework: String(framework || "goat"),
        kind: String(kind || "command"),
        createdAt: new Date()
      };

      const result = await commands.insertOne(command);

      res.status(201).json({
        success: true,
        id: result.insertedId,
        name: command.name,
        author: command.author
      });
    } catch (error) {
      console.error("Upload error:", error.message);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.get("/api/commands", async (req, res) => {
    try {
      const filter = {};
      if (req.query.name) {
        filter.name = {
          $regex: String(req.query.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i"
        };
      }

      if (req.query.author) {
        filter.author = String(req.query.author);
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      const results = await commands
        .find(filter, { projection: { rawCode: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      res.json({ success: true, count: results.length, commands: results });
    } catch (error) {
      console.error("Search error:", error.message);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/commands/:id", async (req, res) => {
    try {
      const { ObjectId } = require("mongodb");
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid command ID" });
      }

      const command = await commands.findOne({
        _id: new ObjectId(req.params.id)
      });

      if (!command) {
        return res.status(404).json({ error: "Command not found" });
      }

      res.json(command);
    } catch (error) {
      console.error("Fetch error:", error.message);
      res.status(500).json({ error: "Request failed" });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Omega Store API running on port ${PORT}`);
  });
}

startServer().catch(error => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
