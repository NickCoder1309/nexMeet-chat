import { Server, type Socket } from "socket.io";
import "dotenv/config";
import { request } from "./request";

const origins = (process.env.ORIGIN ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

const io = new Server({ cors: { origin: origins } });

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

io.on("connection", (socket: Socket) => {
  socket.on("newUser", async (userId: string, meetId: string) => {
    console.log(`Attempting to register new user.`);

    try {
      if (!meetId || !userId) return;

      const meetUsers = await request<UserWithSocketId[] | BackendError>({
        method: "PUT",
        endpoint: `/api/meetings/updateOrAddMeetingUser/${meetId}`,
        data: { userId, socketId: socket.id },
        headers: { "Content-Type": "application/json" },
      });

      socket.join(meetId);

      if (!meetUsers || "error" in meetUsers) {
        socket.emit("socketServerError", {
          origin: "newUser",
          message:
            meetUsers && "error" in meetUsers
              ? meetUsers.error
              : "Error inesperado",
        });
        return;
      }

      const joiningUser = meetUsers.find((u) => u.userId === userId) || null;
      const leavingUser = null;

      console.log(
        `New user with id ${userId}, there's ${meetUsers.length} users.`,
      );

      io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
    } catch (error) {
      socket.emit("socketServerError", {
        origin: "backend",
        message: error instanceof Error ? error.message : "Error inesperado",
      });
    }
  });

  socket.on("sendMessage", (meetId: string, payload: ChatMessagePayload) => {
    console.log(`Attempting to send new message.`);

    try {
      const trimmed = payload?.message?.trim();
      if (!trimmed) return;

      const outgoing = {
        userId: payload.userId,
        message: trimmed,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      console.log(`New message from user with id ${payload.userId} sent.`);

      io.to(meetId).emit("newMessage", outgoing);
    } catch (error) {
      socket.emit("socketServerError", {
        origin: "backend",
        message: error instanceof Error ? error.message : "Error inesperado",
      });
    }
  });

  socket.on("disconnect", async (userId: string, meetId: string) => {
    try {
      const meetUsers = await request<UserWithSocketId[]>({
        method: "POST",
        endpoint: `/api/meetings/removeUser/${meetId}`,
        data: { userId },
        headers: { "Content-Type": "application/json" },
      });

      if (!meetUsers || "error" in meetUsers) {
        socket.emit("socketServerError", {
          origin: "disconnect",
          message:
            meetUsers && "error" in meetUsers
              ? meetUsers.error
              : "Error inesperado",
        });
        return;
      }

      const joiningUser = null;
      const leavingUser = meetUsers.find((u) => u.userId === userId) || null;

      io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
    } catch (error) {
      socket.emit("socketServerError", {
        origin: "backend",
        message: error instanceof Error ? error.message : "Error inesperado",
      });
    }
  });
});

io.listen(port);
