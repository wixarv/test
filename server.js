require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/db");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userId) return;
    const userSockets = connectedUsers.get(userId) || [];
    if (!userSockets.includes(socket.id)) {
      userSockets.push(socket.id);
      connectedUsers.set(userId, userSockets);
    }
    socket.emit("registered", { userId });
  });

  socket.on("disconnect", () => {
    for (const [userId, sockets] of connectedUsers.entries()) {
      const filtered = sockets.filter((id) => id !== socket.id);
      if (filtered.length) {
        connectedUsers.set(userId, filtered);
      } else {
        connectedUsers.delete(userId);
      }
    }
  });

  socket.on("forceLogout", (data) => {
    console.log("Force logout from user:", data.userId);
  });
});

app.set("io", io);
app.set("connectedUsers", connectedUsers);

connectDB();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
