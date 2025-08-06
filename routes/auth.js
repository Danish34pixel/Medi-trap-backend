const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const upload = require("../upload");
const router = express.Router();

// Signup route with avatar upload
router.post("/signup", upload.single("drugLicenseImage"), async (req, res) => {
  console.log("BODY:", req.body);
  console.log("FILE:", req.file);
  const {
    medicalName,
    ownerName,
    address,
    email,
    contactNo,
    drugLicenseNo,
    password,
  } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User exists" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const drugLicenseImage = req.file
      ? `/uploads/${req.file.filename}`
      : undefined;
    const user = new User({
      medicalName,
      ownerName,
      address,
      email,
      contactNo,
      drugLicenseNo,
      drugLicenseImage,
      password: hashedPassword,
    });
    await user.save();
    res.status(201).json({ message: "User created" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Login route
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token, drugLicenseImage: user.drugLicenseImage });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
