require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { Booking, Counter } = require("./models");
const { requireAuth } = require("./auth");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

const ROOM_NUMBERS = [1,2,3,4,5,6,7,8,9];
let allocationQueue = Promise.resolve();

// Queue allocation requests within this server process to avoid two simultaneous
// requests choosing the same room. For multi-server deployments, use a MongoDB
// transaction on a replica set or a dedicated atomic reservation strategy.
function serializeAllocation(work) {
  const current = allocationQueue.then(work, work);
  allocationQueue = current.catch(() => {});
  return current;
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}
function dateRangeValid(checkIn, checkOut) {
  return checkIn && checkOut && checkOut > checkIn;
}
function overlaps(existing, start, end) {
  // Checkout day is not an occupied night: adjacent bookings are allowed.
  return existing.checkIn < end && existing.checkOut > start;
}
function cleanText(v, max = 120) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

app.get("/api/health", (_req, res) => res.json({ ok: true, rooms: 9 }));

app.post("/api/auth/login", async (req, res) => {
  const username = cleanText(req.body?.username, 100);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedUsername = process.env.ADMIN_USERNAME || "admin";
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!hash || username !== expectedUsername || !(await bcrypt.compare(password, hash))) {
    return res.status(401).json({ message: "Invalid username or password. Check your server .env setup." });
  }
  const token = jwt.sign({ username, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username });
});

app.use("/api", requireAuth);

app.get("/api/rooms", async (_req, res, next) => {
  try {
    res.json(ROOM_NUMBERS.map(n => ({ roomNo: n, name: `Room ${n}` })));
  } catch (e) { next(e); }
});

app.get("/api/bookings", async (req, res, next) => {
  try {
    const filter = {};
    const search = cleanText(req.query.search, 120);
    const status = cleanText(req.query.status, 30);
    if (status && ["Booked", "Checked-in", "Checked-out", "Cancelled"].includes(status)) filter.status = status;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { visitorName: { $regex: escaped, $options: "i" } },
        { department: { $regex: escaped, $options: "i" } },
        { contact: { $regex: escaped, $options: "i" } },
        { bookingId: { $regex: escaped, $options: "i" } }
      ];
    }
    const bookings = await Booking.find(filter).sort({ checkIn: -1, createdAt: -1 }).limit(1000).lean();
    res.json(bookings);
  } catch (e) { next(e); }
});

app.get("/api/dashboard", async (req, res, next) => {
  try {
    const day = parseDateOnly(String(req.query.date || new Date().toISOString().slice(0,10)));
    if (!day) return res.status(400).json({ message: "Date must be YYYY-MM-DD." });
    const nextDay = new Date(day.getTime() + 86400000);
    const active = await Booking.find({
      status: { $ne: "Cancelled" }, checkIn: { $lt: nextDay }, checkOut: { $gt: day }
    }).lean();
    const rooms = ROOM_NUMBERS.map(roomNo => {
      const booking = active.find(b => b.roomNo === roomNo && b.checkIn < nextDay && b.checkOut > day);
      return { roomNo, status: booking ? "Occupied" : "Available", booking: booking || null };
    });
    const checkIns = await Booking.find({ status: { $ne: "Cancelled" }, checkIn: day }).sort({ roomNo: 1 }).lean();
    const checkOuts = await Booking.find({ status: { $ne: "Cancelled" }, checkOut: day }).sort({ roomNo: 1 }).lean();
    res.json({
      date: day.toISOString().slice(0,10), rooms,
      occupied: rooms.filter(r => r.status === "Occupied").length,
      available: rooms.filter(r => r.status === "Available").length,
      checkIns, checkOuts
    });
  } catch (e) { next(e); }
});

app.post("/api/bookings/availability", async (req, res, next) => {
  try {
    const checkIn = parseDateOnly(req.body?.checkIn);
    const checkOut = parseDateOnly(req.body?.checkOut);
    if (!dateRangeValid(checkIn, checkOut)) return res.status(400).json({ message: "Check-out must be after check-in. Use valid dates." });
    const active = await Booking.find({ status: { $ne: "Cancelled" }, roomNo: { $in: ROOM_NUMBERS }, checkIn: { $lt: checkOut }, checkOut: { $gt: checkIn } }).lean();
    const unavailable = new Set(active.filter(b => overlaps(b, checkIn, checkOut)).map(b => b.roomNo));
    res.json({ availableRooms: ROOM_NUMBERS.filter(n => !unavailable.has(n)).map(n => ({ roomNo: n, name: `Room ${n}` })) });
  } catch (e) { next(e); }
});

app.post("/api/bookings", async (req, res, next) => {
  try {
    const visitorName = cleanText(req.body?.visitorName);
    const department = cleanText(req.body?.department);
    const contact = cleanText(req.body?.contact, 40);
    const purpose = cleanText(req.body?.purpose, 300);
    const roomNo = Number(req.body?.roomNo);
    const checkIn = parseDateOnly(req.body?.checkIn);
    const checkOut = parseDateOnly(req.body?.checkOut);
    if (!visitorName) return res.status(400).json({ message: "Visitor name is required." });
    if (!dateRangeValid(checkIn, checkOut)) return res.status(400).json({ message: "Check-out must be after check-in. Use valid dates." });
    if (!ROOM_NUMBERS.includes(roomNo)) return res.status(400).json({ message: "Choose one of the 9 valid rooms." });

    const booking = await serializeAllocation(async () => {
      const conflict = await Booking.findOne({
        roomNo, status: { $ne: "Cancelled" },
        checkIn: { $lt: checkOut }, checkOut: { $gt: checkIn }
      }).lean();
      if (conflict) {
        const err = new Error(`Room ${roomNo} is no longer available for those dates. Refresh availability and choose another room.`);
        err.status = 409;
        throw err;
      }
      const counter = await Counter.findOneAndUpdate(
        { _id: "booking" }, { $inc: { seq: 1 } }, { upsert: true, new: true }
      );
      return Booking.create({
        bookingId: `GR-${String(counter.seq).padStart(5, "0")}`,
        visitorName, department, contact, purpose, roomNo, checkIn, checkOut, status: "Booked"
      });
    });
    res.status(201).json(booking);
  } catch (e) { next(e); }
});

app.patch("/api/bookings/:id/status", async (req, res, next) => {
  try {
    const allowed = ["Booked", "Checked-in", "Checked-out", "Cancelled"];
    const status = cleanText(req.body?.status, 30);
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid booking status." });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (booking.status === "Cancelled" && status !== "Cancelled") {
      return res.status(400).json({ message: "Cancelled bookings cannot be reactivated. Create a new booking instead." });
    }
    if (status !== "Cancelled" && status !== booking.status) {
      const conflict = await Booking.findOne({
        _id: { $ne: booking._id }, roomNo: booking.roomNo, status: { $ne: "Cancelled" },
        checkIn: { $lt: booking.checkOut }, checkOut: { $gt: booking.checkIn }
      }).lean();
      if (conflict) return res.status(409).json({ message: "Cannot reactivate or update this booking: its room dates conflict with another booking." });
    }
    booking.status = status;
    await booking.save();
    res.json(booking);
  } catch (e) { next(e); }
});

app.delete("/api/bookings/:id", async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    booking.status = "Cancelled";
    await booking.save();
    res.json({ message: "Booking cancelled; the dates are now available.", booking });
  } catch (e) { next(e); }
});

// Serve production frontend after `npm run build`.
const dist = path.join(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(dist, "index.html"), err => err && next(err));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Server error." });
});

const port = Number(process.env.PORT || 5000);
async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    throw new Error("Set JWT_SECRET to a random string of at least 24 characters in .env.");
  }
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/guest_room_manager");
  console.log("Connected to MongoDB");
  app.listen(port, () => console.log(`Guest Room Manager API running on http://localhost:${port}`));
}
start().catch(err => { console.error(err); process.exit(1); });
