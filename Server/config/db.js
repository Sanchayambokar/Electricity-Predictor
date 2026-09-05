const mongoose = require("mongoose");
const dns = require("dns");

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.warn("⚠️ No MONGO_URI provided in environment. Running in-memory mock mode.");
    return;
  }

  // Ensure Node DNS resolver can resolve MongoDB Atlas SRV records (bypasses ISP/router SRV blocks)
  try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
  } catch (e) {
    // Fallback to system DNS if custom servers cannot be set
  }

  try {
    mongoose.set("bufferCommands", false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log("✅ MongoDB Connected successfully");

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected.");
    });
  } catch (error) {
    console.warn(`⚠️ MongoDB connection skipped (${error.message}). In-memory fallback is active.`);
  }
};

module.exports = connectDB;
