const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true, index: true },
  visitorName: { type: String, required: true, trim: true, maxlength: 120 },
  department: { type: String, trim: true, maxlength: 120, default: "" },
  contact: { type: String, trim: true, maxlength: 40, default: "" },
  purpose: { type: String, trim: true, maxlength: 300, default: "" },
  roomNo: { type: Number, required: true, min: 1, max: 9 },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  status: { type: String, enum: ["Booked", "Checked-in", "Checked-out", "Cancelled"], default: "Booked" },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

bookingSchema.index({ roomNo: 1, checkIn: 1, checkOut: 1, status: 1 });

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

module.exports = {
  Booking: mongoose.model("Booking", bookingSchema),
  Counter: mongoose.model("Counter", counterSchema)
};
