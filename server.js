require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://bananatype.vercel.app/", // Frontend URL
    methods: ["GET", "POST"],
  },
});

// Simple health check route
app.get("/", (req, res) => {
  res.send("Socket server is running!");
});

// Middleware
app.use(cors());
app.use(express.json());

// In-memory store for rooms and players
const rooms = {};

/**
 * Structure of `rooms`:
 * rooms = {
 *   roomId: {
 *     admin: socketId,       // the admin's socket id
 *     players: {
 *       [socketId]: {
 *         typedText: string,
 *         wpm: number,
 *         accuracy: number,
 *       },
 *       ...
 *     },
 *   },
 *   ...
 * }
 */

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create a new room
  socket.on("createRoom", ({ roomId, userId }) => {
    // Create the room and mark the creator as admin
    rooms[roomId] = {
      admin: socket.id,
      players: {},
    };
    // Add the admin as the first player in the room
    rooms[roomId].players[socket.id] = {
      typedText: "",
      wpm: 0,
      accuracy: 100,
    };

    socket.join(roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
    
    // Notify the creator that the room has been created,
    // and send back the players list so the admin's state updates.
    socket.emit("roomCreated", { roomId, isAdmin: true, players: rooms[roomId].players });
    
    // Broadcast an update of the leaderboard to everyone in the room
    io.to(roomId).emit("updateLeaderboard", { players: rooms[roomId].players });
  });

  // Join an existing room
  socket.on("joinRoom", ({ roomId }) => {
    if (!rooms[roomId]) {
      socket.emit("errorMessage", "Room does not exist");
      console.log("Room does not exist");
      return;
    }
    if (rooms[roomId].players[socket.id]) {
      socket.emit("errorMessage", "User already in room");
      console.log("User already in room");
      return;
    }
    // Add the new player to the room
    rooms[roomId].players[socket.id] = {
      typedText: "",
      wpm: 0,
      accuracy: 100,
    };
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    // Notify the joining client that they have joined, and that they're not admin
    socket.emit("roomJoined", { roomId, isAdmin: false });
    
    // Broadcast updated player list to everyone in the room
    io.to(roomId).emit("playerJoined", { players: rooms[roomId].players });
  });

  // Update player's progress (typing updates)
  socket.on("updateProgress", ({ roomId, typedText }) => {
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].typedText = typedText;
      // Broadcast updated leaderboard to all players in the room
      io.to(roomId).emit("updateLeaderboard", { players: rooms[roomId].players });
    }
  });

  // Start the typing test (admin only)
  socket.on("startTest", ({ roomId }) => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].admin !== socket.id) {
      socket.emit("errorMessage", "Only admin can start the test");
      return;
    }
    console.log(`Room ${roomId} test starting initiated by admin ${socket.id}`);

    // Start a countdown from 3 to 0
    let count = 3;
    const countdownInterval = setInterval(() => {
      io.to(roomId).emit("countdown", { count });
      count--;
      if (count < 0) {
        clearInterval(countdownInterval);
        // Signal all players to start typing
        io.to(roomId).emit("startTyping");
        // After 60 seconds, end the test and broadcast final results
        setTimeout(() => {
          io.to(roomId).emit("finalResults", { players: rooms[roomId].players });
        }, 60000);
      }
    }, 1000);
  });

  // Handle disconnecting players
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        // Remove the player from the room
        delete rooms[roomId].players[socket.id];
        // Update the leaderboard for the room
        io.to(roomId).emit("updateLeaderboard", { players: rooms[roomId].players });
        // If the disconnected player was the admin, assign a new admin if possible
        if (rooms[roomId].admin === socket.id) {
          const remainingPlayers = Object.keys(rooms[roomId].players);
          if (remainingPlayers.length > 0) {
            rooms[roomId].admin = remainingPlayers[0];
            // Optionally, you can notify the new admin of their status
          } else {
            // Delete the room if no players remain
            delete rooms[roomId];
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
