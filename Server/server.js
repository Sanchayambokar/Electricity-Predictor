const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const predictRoute = require("./routes/predictRoute");
const extractRoute = require("./routes/extractRoute");

dotenv.config({ path: path.join(__dirname, '..', '.env') });

connectDB();

const app = express();

app.use(cors());
app.use(express.json());


// Routes
app.use("/api/auth", authRoutes);
app.use("/api", predictRoute);
app.use("/api", extractRoute);
app.use("/api/history", require("./routes/historyRoute"));

app.get("/", (req, res) => {
  res.send("API Running...");
  console.log("Server is run on / port")
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});