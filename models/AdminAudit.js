const mongoose = require("mongoose");

const adminAuditSchema = new mongoose.Schema(
  {
    actor: {
      // id of the admin who performed the action
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actorEmail: { type: String },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    action: {
      type: String,
      enum: ["approve", "decline"],
      required: true,
    },
    note: { type: String },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminAudit", adminAuditSchema);
