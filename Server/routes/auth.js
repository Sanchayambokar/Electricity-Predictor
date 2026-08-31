const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "ElectricityAnalyser";

// Configure email transporter
const getEmailTransporter = () => {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const rawPass = process.env.SMTP_PASS || "";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);

  if (!user || !rawPass) {
    return null;
  }

  // Remove spaces that Google puts in App Passwords (e.g. "xwsx zqkv jbym qtkk" -> "xwsxzqkvjbymqtkk")
  const cleanPass = rawPass.replace(/\s+/g, "").trim();

  // If host is Gmail or user is @gmail.com, use nodemailer's built-in Gmail service configuration
  if (host.toLowerCase().includes("gmail") || user.toLowerCase().endsWith("@gmail.com")) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass: cleanPass,
      },
    });
  }

  if (!host) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass: cleanPass,
    },
  });
};

async function sendResetEmail(toEmail, otp) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    console.log(`[Email Simulation] SMTP not configured in environment. Verification code for ${toEmail}: ${otp}`);
    return { sent: false, reason: "SMTP not configured" };
  }

  const fromAddress = process.env.EMAIL_FROM || `"Electricity Analyser" <${process.env.SMTP_USER}>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff;">
      <h2 style="color: #1d4ed8; margin-top: 0;">Password Reset Request</h2>
      <p style="color: #374151; font-size: 15px;">Hello,</p>
      <p style="color: #374151; font-size: 15px;">We received a request to reset the password for your Electricity Analyser account associated with <strong>${toEmail}</strong>.</p>
      <div style="margin: 24px 0; padding: 16px; background-color: #eff6ff; border-radius: 6px; text-align: center;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1e40af; font-family: monospace;">${otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px;">This verification code is valid for 15 minutes. If you did not request a password reset, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Electricity Bill Predictor &amp; Consumption Analyser</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: "Your Password Reset Code - Electricity Analyser",
      text: `Your password reset code is: ${otp}. This code is valid for 15 minutes.`,
      html: htmlContent,
    });
    console.log(`✅ Email successfully sent to ${toEmail} (Message ID: ${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`⚠️ Email delivery to ${toEmail} skipped (${err.message}). In-app OTP fallback active.`);
    return { sent: false, error: err.message };
  }
}


// In-memory fallback user store when MongoDB is unavailable
const fallbackFilePath = path.join(process.cwd(), "fallback_users.json");
let memoryUsers = [
  {
    _id: "mem_demo_user",
    fname: "Test",
    lname: "User",
    email: "test@example.com",
    // bcrypt hash for "password"
    password: "$2a$10$7r6N3l8F4w.6pM3.i66vce8bNfG3a0nQ2fG0wzX/k57aN73vE9212",
  },
];

// Try to load persisted fallback users
try {
  if (fs.existsSync(fallbackFilePath)) {
    const data = fs.readFileSync(fallbackFilePath, "utf8");
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryUsers = parsed;
    }
  }
} catch (e) {
  console.warn("Failed to load fallback_users.json", e.message);
}

const saveMemoryUsers = () => {
  try {
    fs.writeFileSync(fallbackFilePath, JSON.stringify(memoryUsers, null, 2), "utf8");
  } catch (e) {
    console.warn("Failed to save fallback_users.json", e.message);
  }
};


router.post("/register", async (req, res) => {
  try {
    const { fname, lname, email, password } = req.body;

    try {
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new User({ fname, lname, email, password: hashedPassword });
      await user.save();

      const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });

      console.log(`New user registered (MongoDB): ${email}`);
      return res.json({ message: "Registration successful!", token });
    } catch (dbErr) {
      console.warn("MongoDB unavailable, using in-memory registration fallback:", dbErr.message);
      const existingMem = memoryUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (existingMem) {
        return res.status(400).json({ message: "Email already registered" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const memUser = {
        _id: "mem_" + Date.now(),
        fname,
        lname,
        email,
        password: hashedPassword
      };
      memoryUsers.push(memUser);
      saveMemoryUsers(); // Persist to file
      const token = jwt.sign({ id: memUser._id, email: memUser.email }, JWT_SECRET, { expiresIn: "30d" });
      console.log(`New user registered (In-Memory Fallback): ${email}`);
      return res.json({ message: "Registration successful!", token });
    }

  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email });
      if (user) {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(400).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });

        console.log(`User logged in (MongoDB): ${email}`);
        return res.status(200).json({
            message: "Login successful!",
            token,
            user: {
                name: user.fname + " " + user.lname,
                email: user.email,
                initials: user.fname.charAt(0).toUpperCase() + user.lname.charAt(0).toUpperCase()
            }
        });
      }
    } catch (dbErr) {
      console.warn("MongoDB unavailable, checking in-memory user store:", dbErr.message);
    }

    const memUser = memoryUsers.find(u => u.email.toLowerCase() === (email || "").toLowerCase());
    if (!memUser) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatchMem = await bcrypt.compare(password, memUser.password);
    if (!isMatchMem) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: memUser._id, email: memUser.email }, JWT_SECRET, { expiresIn: "30d" });

    console.log(`User logged in (In-Memory): ${email}`);
    return res.status(200).json({
        message: "Login successful!",
        token,
        user: {
            name: memUser.fname + " " + memUser.lname,
            email: memUser.email,
            initials: memUser.fname.charAt(0).toUpperCase() + memUser.lname.charAt(0).toUpperCase()
        }
    });

  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// FORGOT PASSWORD - Request OTP
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email address is required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    // Generate 6-digit OTP code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    let userFound = false;

    // Check MongoDB
    try {
      const user = await User.findOne({ email: cleanEmail });
      if (user) {
        user.resetToken = otp;
        user.resetTokenExpiry = expiry;
        await user.save();
        userFound = true;
        console.log(`Password reset OTP generated for (MongoDB): ${cleanEmail} -> ${otp}`);
      }
    } catch (dbErr) {
      console.warn("MongoDB unavailable for forgot-password:", dbErr.message);
    }

    // Check In-Memory
    const memUser = memoryUsers.find((u) => u.email.toLowerCase() === cleanEmail);
    if (memUser) {
      memUser.resetToken = otp;
      memUser.resetTokenExpiry = expiry;
      saveMemoryUsers();
      userFound = true;
      console.log(`Password reset OTP generated for (In-Memory): ${cleanEmail} -> ${otp}`);
    }

    if (!userFound) {
      return res.status(404).json({ message: "No account found with this email address." });
    }

    const emailResult = await sendResetEmail(cleanEmail, otp);

    let responseMessage = "Verification code sent to your email address.";
    if (!emailResult.sent) {
      if (emailResult.error && emailResult.error.includes("535")) {
        responseMessage = "Email could not be delivered (Gmail requires a 16-character App Password). Use the code below to proceed:";
      } else if (emailResult.reason === "SMTP not configured") {
        responseMessage = "Reset code generated (SMTP not configured). Use the code below to proceed:";
      } else {
        responseMessage = "Email delivery issue. Use the verification code below to proceed:";
      }
    }

    return res.status(200).json({
      message: responseMessage,
      email: cleanEmail,
      code: otp, // Always provide verification code so the user is never stuck
      emailSent: emailResult.sent,
      emailError: emailResult.error || null,
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({ message: error.message || "Failed to process forgot password request" });
  }
});

// VERIFY CODE
router.post("/verify-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and verification code are required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanCode = String(code).trim();

    let verified = false;

    // MongoDB check
    try {
      const user = await User.findOne({
        email: cleanEmail,
        resetToken: cleanCode,
        resetTokenExpiry: { $gt: new Date() },
      });
      if (user) {
        verified = true;
      }
    } catch (dbErr) {
      console.warn("MongoDB check error in verify-code:", dbErr.message);
    }

    // In-memory check
    if (!verified) {
      const memUser = memoryUsers.find(
        (u) =>
          u.email.toLowerCase() === cleanEmail &&
          u.resetToken === cleanCode &&
          u.resetTokenExpiry &&
          new Date(u.resetTokenExpiry) > new Date()
      );
      if (memUser) {
        verified = true;
      }
    }

    if (!verified) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    return res.status(200).json({ success: true, message: "Verification code is valid." });
  } catch (error) {
    console.error("Verify code error:", error.message);
    return res.status(500).json({ message: error.message || "Failed to verify code" });
  }
});

// RESET PASSWORD
router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanCode = String(code).trim();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    let updated = false;

    // MongoDB Update
    try {
      const user = await User.findOne({
        email: cleanEmail,
        resetToken: cleanCode,
        resetTokenExpiry: { $gt: new Date() },
      });
      if (user) {
        user.password = hashedPassword;
        user.resetToken = null;
        user.resetTokenExpiry = null;
        await user.save();
        updated = true;
        console.log(`Password reset completed (MongoDB) for: ${cleanEmail}`);
      }
    } catch (dbErr) {
      console.warn("MongoDB reset-password error:", dbErr.message);
    }

    // In-Memory Update
    const memUser = memoryUsers.find(
      (u) =>
        u.email.toLowerCase() === cleanEmail &&
        u.resetToken === cleanCode &&
        u.resetTokenExpiry &&
        new Date(u.resetTokenExpiry) > new Date()
    );
    if (memUser) {
      memUser.password = hashedPassword;
      memUser.resetToken = null;
      memUser.resetTokenExpiry = null;
      saveMemoryUsers();
      updated = true;
      console.log(`Password reset completed (In-Memory) for: ${cleanEmail}`);
    }

    if (!updated) {
      return res.status(400).json({ message: "Invalid or expired reset code. Please request a new one." });
    }

    return res.status(200).json({
      message: "Password reset successful! You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({ message: error.message || "Failed to reset password" });
  }
});

module.exports = router;
