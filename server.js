require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");

const app = express();

app.use(cors({ origin: ["http://localhost:3000","www.vsacracker.in","https://www.vsacracker.in","http://vsacracker.in","https://vsacracker.in","http://www.vsacracker.in","https://www.vsacracker.in"], credentials: true , methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  });

      
