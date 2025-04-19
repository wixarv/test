require("dotenv").config();
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const connectedUsers = new Map(); // Map<userId, socketId[]>

io.use((socket, next) => {
  next();
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userId) {
      console.log("Invalid userId received for registration");
      return;
    }
    const userSockets = connectedUsers.get(userId) || [];
    if (!userSockets.includes(socket.id)) {
      userSockets.push(socket.id);
      connectedUsers.set(userId, userSockets);
    }
    console.log(`User ${userId} registered with socket ${socket.id}`);
    console.log("Current connected users:", [...connectedUsers.entries()]);
    socket.emit("registered", { userId });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const [userId, sockets] of connectedUsers.entries()) {
      const updatedSockets = sockets.filter((id) => id !== socket.id);
      if (updatedSockets.length > 0) {
        connectedUsers.set(userId, updatedSockets);
      } else {
        connectedUsers.delete(userId);
      }
      console.log(`Updated sockets for user ${userId}:`, updatedSockets);
    }
    console.log("Updated connected users:", [...connectedUsers.entries()]);
  });

  socket.on("forceLogout", (data) => {
    console.log("Force logout event received on server for user:", data.userId);
  });
});
app.set("io", io);
app.set("connectedUsers", connectedUsers);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

