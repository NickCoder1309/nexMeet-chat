import { Server, type Socket } from "socket.io";
import "dotenv/config";
import { request } from "./request";
import jwt from "jsonwebtoken";

const origins = (process.env.ORIGINS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * Initializes the Socket.io server with CORS configuration.
 * Allows connections only from configured origins.
 */
const io = new Server({
  cors: {
    origin: origins,
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

const port = Number(process.env.PORT);

type ChatMessagePayload = {
  userId: string;
  message: string;
  timestamp?: string;
};

type UserWithSocketId = {
  userId: string;
  socketId: string;
  name?: string | null;
  email?: string | null;
  age?: number | null;
  photoURL?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type BackendError = { error: string };

io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  console.log("Authenticating socket:", socket.id);

  if (!token) {
    console.error("No token provided");
    return next(new Error("Authentication token required"));
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      console.error("❌ JWT_SECRET not configured");
      return next(new Error("Server configuration error"));
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email?: string;
    };

    socket.data.userId = decoded.userId;
    socket.data.email = decoded.email;
    socket.data.token = token;

    console.log("Token valid for user:", decoded.userId);
    next();
  } catch (error) {
    console.error("❌ Invalid token:", error);
    return next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket: Socket) => {
  console.log("✅ Authenticated connection:", socket.id);
  console.log("   User ID:", socket.data.userId);

  /**
   * Registers a new user joining a meeting.
   *
   * @event newUser
   * @param {string} meetId - ID of the meeting room.
   */
  socket.on("newUser", async (meetId: string) => {
    const userId = socket.data.userId;
    const token = socket.data.token;

    console.log(`Attempting to register user: ${userId} in meeting: ${meetId}`);

    try {
      if (!meetId) {
        socket.emit("socketServerError", {
          origin: "newUser",
          message: "Meeting ID is required",
        });
        return;
      }

      socket.data.meetId = meetId;

      /**
       * Sends a request to backend to add or update user in the meeting.
       */
      const meetUsers = await request<UserWithSocketId[] | BackendError>({
        method: "PUT",
        endpoint: `/api/meetings/updateOrAddMeetingUser/${meetId}`,
        data: { userId, socketId: socket.id },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!meetUsers || "error" in meetUsers) {
        console.error("Error getting meeting users:", meetUsers);
        socket.emit("socketServerError", {
          origin: "newUser",
          message:
            meetUsers && "error" in meetUsers
              ? meetUsers.error
              : "Unexpected error",
        });
        return;
      }

      socket.join(meetId);

      const joiningUser = meetUsers.find((u) => u.userId === userId) || null;
      const leavingUser = null;

      console.log(`User ${userId} joined. Total users: ${meetUsers.length}`);

      /**
       * Emitted when the user list in the meeting changes.
       */
      io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
    } catch (error) {
      console.error("Error in newUser:", error);
      socket.emit("socketServerError", {
        origin: "backend",
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  /**
   * Sends a chat message to all users in a meeting.
   *
   * @event sendMessage
   * @param {ChatMessagePayload} payload - Message payload.
   */
  socket.on("sendMessage", (payload: ChatMessagePayload) => {
    const meetId = socket.data.meetId;
    const userId = socket.data.userId;

    console.log(`Attempting to send message in meeting: ${meetId}`);

    try {
      const trimmed = payload?.message?.trim();
      if (!trimmed) {
        console.log("Empty message");
        return;
      }

      if (payload.userId !== userId) {
        console.error("❌ User ID mismatch");
        socket.emit("socketServerError", {
          origin: "sendMessage",
          message: "Unauthorized: User ID mismatch",
        });
        return;
      }

      const outgoing = {
        userId: payload.userId,
        message: trimmed,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      console.log(`Message sent from user ${payload.userId}`);

      /**
       * Emitted when a new chat message is broadcasted.
       */
      io.to(meetId).emit("newMessage", outgoing);
    } catch (error) {
      console.error("Error in sendMessage:", error);
      socket.emit("socketServerError", {
        origin: "backend",
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  /**
   * Cleans up user data when their socket disconnects.
   *
   * @event disconnect
   */
  socket.on("disconnect", async () => {
    const { token, userId, meetId } = socket.data;

    console.log(`Socket ${socket.id} disconnected`);

    try {
      if (!userId || !meetId) {
        console.log("No user data found for disconnected socket");
        return;
      }

      console.log(`Cleaning up user ${userId} from meeting ${meetId}`);

      socket.leave(meetId);

      /**
       * Sends a request to backend to remove user from the meeting.
       */
      const meetUsers = await request<UserWithSocketId[] | BackendError>({
        method: "PUT",
        endpoint: `/api/meetings/removeUser/${meetId}`,
        data: { userId, socketId: socket.id },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!meetUsers || "error" in meetUsers) {
        console.error("Error removing user:", meetUsers);
        return;
      }

      const joiningUser = null;
      const leavingUser = { userId, socketId: socket.id };

      console.log(`User ${userId} removed. Remaining: ${meetUsers.length}`);

      io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
    } catch (error) {
      console.error("Error in disconnect handler:", error);
    }
  });

  /**
   * Handle authentication errors
   */
  socket.on("error", (error) => {
    console.error("Socket error:", error);
    if (error.message.includes("token") || error.message.includes("auth")) {
      socket.emit("socketServerError", {
        origin: "authentication",
        message: error.message,
      });
      socket.disconnect();
    }
  });
});

io.listen(port);
console.log(`Chat server running on port ${port}`);
