const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json({ limit: "1mb" }));

// ======================================================
// SESSION STORAGE
// ======================================================

// Stores all active Blueprint Round sessions.
//
// Example:
// "4827" -> session data
//
// This is shared by all users connected to this server.

const sessions = new Map();

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "Blueprint Round",
        time: new Date().toISOString()
    });
});

// ======================================================
// GET SESSION
// ======================================================

app.get("/api/sessions/:code", (req, res) => {

    const code = String(req.params.code).trim();

    // Validate 4-digit session code
    if (!/^[0-9]{4}$/.test(code)) {
        return res.status(400).json({
            error: "Invalid session code."
        });
    }

    const session = sessions.get(code);

    if (!session) {
        return res.status(404).json({
            error: "Session not found."
        });
    }

    return res.status(200).json(session);
});

// ======================================================
// CREATE / UPDATE SESSION
// ======================================================

app.put("/api/sessions/:code", (req, res) => {

    const code = String(req.params.code).trim();

    // Validate 4-digit session code
    if (!/^[0-9]{4}$/.test(code)) {
        return res.status(400).json({
            error: "Invalid session code."
        });
    }

    if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
            error: "Invalid session data."
        });
    }

    const session = req.body;

    // Basic validation
    if (
        !Array.isArray(session.problemIds) ||
        typeof session.teams !== "object" ||
        typeof session.scores !== "object" ||
        typeof session.submissions !== "object" ||
        typeof session.wallets !== "object"
    ) {
        return res.status(400).json({
            error: "Invalid Blueprint session structure."
        });
    }

    // Save/update session
    sessions.set(code, session);

    return res.status(200).json({
        success: true,
        code: code
    });
});

// ======================================================
// DELETE SESSION
// ======================================================

app.delete("/api/sessions/:code", (req, res) => {

    const code = String(req.params.code).trim();

    if (!/^[0-9]{4}$/.test(code)) {
        return res.status(400).json({
            error: "Invalid session code."
        });
    }

    const deleted = sessions.delete(code);

    return res.status(200).json({
        success: true,
        deleted: deleted
    });
});

// ======================================================
// SERVE WEBSITE
// ======================================================

// This serves index.html, CSS, JavaScript, images, etc.

app.use(express.static(__dirname));

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {

    console.error("Server error:", err);

    res.status(500).json({
        error: "Internal server error."
    });
});

// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, "0.0.0.0", () => {

    console.log("==========================================");
    console.log(" Blueprint Round server is running");
    console.log(` Local:  http://localhost:${PORT}`);
    console.log(` Health: http://localhost:${PORT}/health`);
    console.log("==========================================");

});