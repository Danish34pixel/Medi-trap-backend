const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    medicalName: {
      type: String,
      required: [true, "Medical store name is required"],
      trim: true,
      maxlength: [100, "Medical store name cannot exceed 100 characters"],
    },
    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
      maxlength: [50, "Owner name cannot exceed 50 characters"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [200, "Address cannot exceed 200 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    contactNo: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
      match: [/^[0-9+\-\s()]+$/, "Please enter a valid contact number"],
    },
    drugLicenseNo: {
      type: String,
      required: [true, "Drug license number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    drugLicenseImage: {
      type: String,
      required: [true, "Drug license image is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ drugLicenseNo: 1 });

module.exports = mongoose.model("User", userSchema);
