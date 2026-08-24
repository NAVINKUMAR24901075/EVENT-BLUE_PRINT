const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json({ limit: "1mb" }));

// ======================================================
// SESSION STORAGE
// ======================================================

// Active Blueprint Round sessions.
//
// Example:
// "4827" -> session data
//
// This is shared by all users connected to this server.

const sessions = new Map();

// Security state is kept separately from the public session.
// Tokens are never returned by GET /api/sessions.
const teamAttempts = new Map();
// code -> Map(teamId -> {
//   token,
//   disqualified,
//   tabId,
//   createdAt,
//   lastSeen
// })


// ======================================================
// HELPERS
// ======================================================

function validCode(code) {
    return /^[0-9]{4}$/.test(code);
}

function randomToken() {
    return crypto.randomBytes(32).toString("hex");
}


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

    if (!validCode(code)) {
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

    if (!validCode(code)) {
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

    // --------------------------------------------------
    // Team writes must be authenticated.
    // Host writes remain allowed because the existing
    // host workflow does not use a team token.
    // --------------------------------------------------

    const teamId = String(req.get("X-Team-Id") || "");
    const teamToken = String(req.get("X-Team-Token") || "");

    if (teamId || teamToken) {

        const attempts = teamAttempts.get(code);
        const attempt = attempts && attempts.get(teamId);

        if (
            !attempt ||
            attempt.disqualified ||
            attempt.token !== teamToken
        ) {
            return res.status(403).json({
                error: "This quiz attempt is no longer valid."
            });
        }

        if (!session.teams || !session.teams[teamId]) {
            return res.status(403).json({
                error: "Invalid team for this quiz attempt."
            });
        }
    }

    sessions.set(code, session);

    return res.status(200).json({
        success: true,
        code: code
    });
});


// ======================================================
// TEAM SECURITY / JOIN
// ======================================================

app.post("/api/team/join", (req, res) => {

    const code = String(
        req.body && req.body.code || ""
    ).trim();

    const name = String(
        req.body && req.body.name || ""
    ).trim();

    if (!validCode(code)) {
        return res.status(400).json({
            error: "Invalid session code."
        });
    }

    if (!name) {
        return res.status(400).json({
            error: "Team name is required."
        });
    }

    const session = sessions.get(code);

    if (!session) {
        return res.status(404).json({
            error: "Session not found."
        });
    }

    if (session.phase === "ended") {
        return res.status(409).json({
            error: "This quiz has already ended."
        });
    }

    // --------------------------------------------------
    // Same team name cannot join the same quiz twice.
    //
    // This catches:
    // - another device
    // - another browser
    // - another tab attempting to join again
    // --------------------------------------------------

    const duplicateId = Object.keys(session.teams || {}).find(
        id =>
            String(session.teams[id])
                .trim()
                .toLowerCase() === name.toLowerCase()
    );

    if (duplicateId) {

        const attempts = teamAttempts.get(code);
        const attempt = attempts && attempts.get(duplicateId);

        if (attempt) {
            attempt.disqualified = true;
        }

        return res.status(409).json({
            error:
                "This team has already joined this quiz. " +
                "Reusing the same team on another tab or device " +
                "is not allowed; the attempt is disqualified."
        });
    }

    // --------------------------------------------------
    // Create a unique team identity + secret token.
    // --------------------------------------------------

    const teamId = randomToken().slice(0, 12);
    const token = randomToken();

    if (!teamAttempts.has(code)) {
        teamAttempts.set(code, new Map());
    }

    teamAttempts.get(code).set(teamId, {
        token: token,
        disqualified: false,
        tabId: null,
        createdAt: Date.now(),
        lastSeen: Date.now()
    });

    // Make sure required session structures exist.

    if (!session.teams) {
        session.teams = {};
    }

    if (!session.scores) {
        session.scores = {};
    }

    if (!session.submissions) {
        session.submissions = {};
    }

    if (!session.wallets) {
        session.wallets = {};
    }

    if (!session.finished) {
        session.finished = {};
    }

    // Register team.

    session.teams[teamId] = name;

    session.scores[teamId] = 0;

    session.wallets[teamId] = {
        spent: 0,
        remaining: 100
    };

    session.finished[teamId] = false;

    sessions.set(code, session);

    return res.status(200).json({
        success: true,
        code: code,
        teamId: teamId,
        teamName: name,
        token: token,
        session: session
    });
});


// ======================================================
// VALIDATE TEAM ATTEMPT
// ======================================================

app.post("/api/team/validate", (req, res) => {

    const code = String(
        req.body && req.body.code || ""
    ).trim();

    const teamId = String(
        req.body && req.body.teamId || ""
    );

    const token = String(
        req.body && req.body.token || ""
    );

    const tabId = String(
        req.body && req.body.tabId || ""
    );

    if (
        !validCode(code) ||
        !teamId ||
        !token ||
        !tabId
    ) {
        return res.status(400).json({
            error: "Invalid quiz attempt."
        });
    }

    const attempts = teamAttempts.get(code);

    const attempt =
        attempts && attempts.get(teamId);

    if (
        !attempt ||
        attempt.disqualified ||
        attempt.token !== token
    ) {
        return res.status(403).json({
            error: "This quiz attempt is disqualified."
        });
    }

    // --------------------------------------------------
    // Only one browser/tab identity is allowed.
    // --------------------------------------------------

    if (
        attempt.tabId &&
        attempt.tabId !== tabId
    ) {

        attempt.disqualified = true;

        return res.status(409).json({
            error:
                "The quiz was opened in another tab or window. " +
                "The attempt is disqualified."
        });
    }

    attempt.tabId = tabId;
    attempt.lastSeen = Date.now();

    return res.status(200).json({
        success: true
    });
});


// ======================================================
// TEAM PRESENCE / HEARTBEAT
// ======================================================

app.post("/api/team/presence", (req, res) => {

    const code = String(
        req.body && req.body.code || ""
    ).trim();

    const teamId = String(
        req.body && req.body.teamId || ""
    );

    const token = String(
        req.body && req.body.token || ""
    );

    const tabId = String(
        req.body && req.body.tabId || ""
    );

    const attempts = teamAttempts.get(code);

    const attempt =
        attempts && attempts.get(teamId);

    if (
        !attempt ||
        attempt.disqualified ||
        attempt.token !== token
    ) {
        return res.status(403).json({
            error: "Invalid quiz attempt."
        });
    }

    // Another tab/browser identity detected.

    if (
        attempt.tabId &&
        tabId &&
        attempt.tabId !== tabId
    ) {

        attempt.disqualified = true;

        return res.status(409).json({
            error: "Duplicate quiz window detected."
        });
    }

    if (tabId) {
        attempt.tabId = tabId;
    }

    attempt.lastSeen = Date.now();

    return res.status(204).end();
});


// ======================================================
// DISQUALIFY TEAM
// ======================================================

app.post("/api/team/disqualify", (req, res) => {

    const code = String(
        req.body && req.body.code || ""
    ).trim();

    const teamId = String(
        req.body && req.body.teamId || ""
    );

    const token = String(
        req.body && req.body.token || ""
    );

    const attempts = teamAttempts.get(code);

    const attempt =
        attempts && attempts.get(teamId);

    if (
        !attempt ||
        attempt.token !== token
    ) {
        return res.status(403).json({
            error: "Invalid quiz attempt."
        });
    }

    attempt.disqualified = true;

    const session = sessions.get(code);

    if (session && session.finished) {

        session.finished[teamId] = true;

        sessions.set(code, session);
    }

    return res.status(200).json({
        success: true
    });
});


// ======================================================
// DELETE SESSION
// ======================================================

app.delete("/api/sessions/:code", (req, res) => {

    const code = String(
        req.params.code
    ).trim();

    if (!validCode(code)) {
        return res.status(400).json({
            error: "Invalid session code."
        });
    }

    const deleted = sessions.delete(code);

    teamAttempts.delete(code);

    return res.status(200).json({
        success: true,
        deleted: deleted
    });
});


// ======================================================
// SERVE WEBSITE
// ======================================================

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