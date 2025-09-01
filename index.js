require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const port = process.env.PORT || 3000;

// ---------- Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "https://nexrox-digital.vercel.app",
      "http://localhost:5173",
      "https://hilarious-dolphin-b5dd58.netlify.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// ---------- Mongo
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ydu4ilk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ---------- Helpers
const setAuthCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const auth = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};

(async function run() {
  try {
    await client.connect();
    const db = client.db("quantumEdge");
    const users = db.collection("users");
    const jobs = db.collection("jobs");

    // Health
    app.get("/", (_, res) => res.send("QuantumEdge API is running"));

    // -------- Auth: Register
    app.post("/api/auth/register", async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const existing = await users.findOne({ email });
        if (existing)
          return res.status(400).json({ message: "Email already exists" });

        const hashed = await bcrypt.hash(password, 10);
        const doc = {
          name,
          email,
          password: hashed,
          activityLog: { createdAt: new Date(), lastLogin: null },
        };

        const result = await users.insertOne(doc);
        const token = jwt.sign(
          { id: result.insertedId, email },
          process.env.JWT_SECRET,
          {
            expiresIn: "7d",
          }
        );

        setAuthCookie(res, token);
        res.status(201).json({
          message: "User registered successfully",
          user: { id: result.insertedId, name, email },
        });
      } catch (err) {
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // -------- Auth: Login
    app.post("/api/auth/login", async (req, res) => {
      try {
        const { email, password } = req.body;
        if (!email || !password)
          return res.status(400).json({ message: "All fields are required" });

        const user = await users.findOne({ email });
        if (!user)
          return res.status(400).json({ message: "Invalid credentials" });

        const ok = await bcrypt.compare(password, user.password);
        if (!ok)
          return res.status(400).json({ message: "Invalid credentials" });

        await users.updateOne(
          { _id: user._id },
          { $set: { "activityLog.lastLogin": new Date() } }
        );

        const token = jwt.sign(
          { id: user._id, email: user.email },
          process.env.JWT_SECRET,
          {
            expiresIn: "7d",
          }
        );

        setAuthCookie(res, token);
        res.json({
          message: "Login successful",
          user: { id: user._id, name: user.name, email: user.email },
        });
      } catch (err) {
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // -------- Auth: Me (hydrate user from cookie)
    app.get("/api/auth/me", auth, async (req, res) => {
      const user = await users.findOne(
        { _id: new ObjectId(req.user.id) },
        { projection: { password: 0 } }
      );
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ user: { id: user._id, name: user.name, email: user.email } });
    });

    // -------- Auth: Logout (clear cookie)
    app.post("/api/auth/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
      });
      res.json({ message: "Logged out" });
    });

    // -------- Jobs
    app.get("/api/jobs", async (req, res) => {
      const result = await jobs.find().toArray();
      res.send(result);
    });

    // -------- Single Job Get
    app.get("/api/jobs/:id", auth, async (req, res) => {
      const { id } = req.params;
      const result = await jobs.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // POST /api/jobs
    app.post("/api/jobs", auth, async (req, res) => {
      try {
        const job = req.body;
        const result = await jobs.insertOne(job);
        res
          .status(201)
          .json({ message: "Job posted successfully", job: result });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to post job" });
      }
    });

    // PUT /api/jobs/:id - Update a job
    app.put("/api/jobs/:id", auth, async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = req.body;

        // Check if the ID is a valid MongoDB ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid job ID" });
        }

        // Check if the job exists and belongs to the authenticated user
        const existingJob = await jobs.findOne({
          _id: new ObjectId(id),
          authorEmail: req.user.email,
        });

        if (!existingJob) {
          return res
            .status(404)
            .json({ message: "Job not found or unauthorized" });
        }

        // Prepare the update object
        const updateFields = {
          title: updateData.title,
          price: updateData.price,
          pricingType: updateData.pricingType,
          description: updateData.description,
          location: updateData.location,
          experienceLevel: updateData.experienceLevel,
          vacancy: updateData.vacancy,
          skills: updateData.skills,
          updatedAt: new Date(),
        };

        // Perform the update
        const result = await jobs.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Job not found" });
        }

        // Return the updated job
        const updatedJob = await jobs.findOne({ _id: new ObjectId(id) });
        res.json({
          message: "Job updated successfully",
          job: updatedJob,
        });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Delete a job by ID
    app.delete("/api/jobs/:id", auth, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await jobs.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Job not found" });
        }

        res.json({ message: "Job deleted successfully" });
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.listen(port, () => console.log(`API: http://localhost:${port}`));
  } catch (e) {
    e && console.log(e);
  }
})();
