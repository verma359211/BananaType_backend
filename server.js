require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL, // Frontend URL
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
  socket.on("createRoom", ({ roomId,roomName, username }) => {
    // Create the room and mark the creator as admin
    rooms[roomId] = {
			roomname: roomName,
			admin: username,
			players: {},
		};
    // Add the admin as the first player in the room
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      role: "admin",
			name: username,
			typedText: "",
			wpm: 0,
			accuracy: 0,
		};

    socket.join(roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
    
    // Notify the creator that the room has been created,
    // and send back the players list so the admin's state updates.
    socket.emit("roomCreated", {
			roomId,
			username: username,
			room: rooms[roomId],
		});
    console.log(rooms);
    // Broadcast an update of the leaderboard to everyone in the room
    io.to(roomId).emit("updateLeaderboard", { players: rooms[roomId].players });
    // console.log("LOG AFTER ROOM CREATION EMIT");
    // console.log(rooms[roomId]);
  });

  // Join an existing room
  socket.on("joinRoom", ({ roomId, username}) => {
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
    if (rooms[roomId].admin === username) {
      rooms[roomId].players[socket.id] = {
				id: socket.id,
				role: "admin",
				name: username,
				typedText: "",
				wpm: 0,
				accuracy: 0,
			};
    } else {
      rooms[roomId].players[socket.id] = {
				id: socket.id,
				role: "player",
				name: username,
				typedText: "",
				wpm: 0,
				accuracy: 0,
			};
    }
		// Add the new player to the room
		
		socket.join(roomId);
		console.log(`User ${socket.id} joined room ${roomId}`);
		// Notify the joining client that they have joined, and that they're not admin
		socket.emit("roomJoined", {
			roomId,
			username: username,
			room: rooms[roomId],
		});
		// Broadcast updated player list to everyone in the room
		io.to(roomId).emit("playerJoined", { players: rooms[roomId].players });
		// console.log("After player is added",players);
		// console.log(rooms[roomId]);
		// console.log(rooms[roomId].players);
	});

  // Update player's progress (typing updates)
  socket.on("updateProgress", ({ roomId, typedText, accuracy, wpm }) => {
		if (rooms[roomId] && rooms[roomId].players[socket.id]) {
			rooms[roomId].players[socket.id].typedText = typedText;

			rooms[roomId].players[socket.id].accuracy = accuracy;

			rooms[roomId].players[socket.id].wpm = wpm;
			// Broadcast updated leaderboard to all players in the room
			io.to(roomId).emit("updateLeaderboard", {
				players: rooms[roomId].players,
			});
			// console.log(rooms[roomId].players);
			// console.log("After player is updated", players);
		}
	});

  // Start the typing test (admin only)
  socket.on("startTest", ({ roomId }) => {
    if (!rooms[roomId]) return;
    // if (rooms[roomId].admin !== socket.id) {
    //   socket.emit("errorMessage", "Only admin can start the test");
    //   return;
    // }
    if (rooms[roomId]) {
      Object.keys(rooms[roomId].players).forEach((playerId) => {
        rooms[roomId].players[playerId].wpm = 0;
        rooms[roomId].players[playerId].accuracy = 0;
        rooms[roomId].players[playerId].typedText = ""; // Optional: Reset typed text too
      });

      // Broadcast the updated leaderboard to all players in the room
      io.to(roomId).emit("updateLeaderboard", {
        players: rooms[roomId].players,
      });

      console.log(`Reset all players' progress in room ${roomId}`);
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
        // setTimeout(() => {
        //   io.to(roomId).emit("finalResults", { players: rooms[roomId].players });
        // }, 60000);
      }
    }, 1000);
  });

  // Handle disconnecting players
  socket.on("disconnect", () => {
		console.log("User disconnected:", socket.id);

		for (const roomId in rooms) {
			if (!rooms[roomId]) continue; // ✅ Check if room still exists

			if (rooms[roomId].players[socket.id]) {
				// ✅ Remove the player from the room
				delete rooms[roomId].players[socket.id];

				// ✅ If the disconnected player was the admin, assign a new admin
				if (rooms[roomId].admin === socket.id) {
					// ✅ Use socket.id instead of username
					const remainingPlayers = Object.keys(rooms[roomId].players);

					if (remainingPlayers.length > 0) {
						// Assign a new admin
						const newAdminId = remainingPlayers[0]; // Pick first available player
						rooms[roomId].admin = newAdminId;

						// ✅ Update their role to admin
						rooms[roomId].players[newAdminId].role = "admin";

						// Notify the new admin (optional)
						io.to(newAdminId).emit("adminAssigned", {
							message: "You are the new admin",
						});
					} else {
						// ✅ Delete the room if no players remain
						delete rooms[roomId];
					}
				}

				// ✅ Update the leaderboard for the room
				io.to(roomId).emit("updateLeaderboard", {
					players: rooms[roomId].players,
				});

				console.log(`Player ${socket.id} removed from room ${roomId}`);
			}
		}
	});
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
