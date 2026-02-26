require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Connection Error:", err));

// --- DATABASE SCHEMA (Updated for Dynamic Chunking) ---
const sessionSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    passwordHash: { type: String, required: true },
    type: { type: String, enum: ['single', 'session'], default: 'single' },
    files: [{
        originalName: String,
        url: String,       // Kept for legacy (V1/V2 early) compatibility
        publicId: String,  // Kept for legacy compatibility
        chunks: [String],  // Array of Cloudinary URLs for encrypted slices
        format: String,
        size: Number,
        salt: [Number],    // Needed for Client-Side Decryption
        iv: [Number]       // Needed for Client-Side Decryption
    }],
    createdAt: { type: Date, default: Date.now, expires: 172800 } // Auto-deletes after 48 Hours
});

const Session = mongoose.model("Session", sessionSchema);

// --- CLOUDINARY CONFIGURATION ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- HELPER FUNCTIONS ---
async function generateUniqueCode() {
    let isUnique = false;
    let code;
    while (!isUnique) {
        code = String(Math.floor(100000 + Math.random() * 900000));
        const existing = await Session.findOne({ code });
        if (!existing) isUnique = true;
    }
    return code;
}

// ==========================================
// --- API ROUTES ---
// ==========================================

// 1. Get Cloudinary Signature (Secure Upload)
app.get("/api/sign-upload", (req, res) => {
    const timestamp = Math.round((new Date()).getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request({
        timestamp: timestamp,
        folder: "quantc_v2_chunks", // Updated target folder
    }, process.env.CLOUDINARY_API_SECRET);

    res.json({ 
        timestamp, 
        signature, 
        apiKey: process.env.CLOUDINARY_API_KEY, 
        cloudName: process.env.CLOUDINARY_CLOUD_NAME 
    });
});

// 2. Save Session Data
app.post("/api/save-session", async (req, res) => {
    try {
        const { password, files, type } = req.body;
        
        if (!files || files.length === 0 || !password) {
            return res.status(400).json({ success: false, message: "Missing files or password" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const code = await generateUniqueCode();

        await Session.create({ code, passwordHash, type, files });
        res.json({ success: true, code });

    } catch (error) {
        console.error("Save Session Error:", error);
        res.status(500).json({ success: false, message: "Database Error" });
    }
});

// 3. Retrieve Session Files
app.post("/api/retrieve", async (req, res) => {
    try {
        const { code, password } = req.body;
        const session = await Session.findOne({ code });

        if (!session) return res.status(404).json({ success: false, message: "Code not found" });

        const isMatch = await bcrypt.compare(password, session.passwordHash);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid Password" });

        res.json({ success: true, files: session.files });

    } catch (error) {
        console.error("Retrieve Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 4. Update Session (For Edit Mode)
app.post("/api/update-session", async (req, res) => {
    try {
        const { code, password, files } = req.body;
        const session = await Session.findOne({ code });

        if (!session) return res.status(404).json({ success: false, message: "Code not found" });

        const isMatch = await bcrypt.compare(password, session.passwordHash);
        if (!isMatch) return res.status(401).json({ success: false, message: "Unauthorized edit" });

        session.files = files; 
        await session.save();

        res.json({ success: true, message: "Session updated successfully" });

    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- WAKE UP ROUTE (Fixes Cold Start) ---
app.get("/api/ping", (req, res) => {
    res.status(200).json({ status: "Server is awake!" });
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));