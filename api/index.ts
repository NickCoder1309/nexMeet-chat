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
    if (!meetId || !userId) return;

    const meetUsers = await request<UserWithSocketId | BackendError>({
      method: "PUT",
      endpoint: `/api/meetings/updateOrAddMeetingUser/${meetId}`,
      data: { userId, socketId: socket.id },
      headers: { "Content-Type": "application/json" },
    });

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

    io.to(meetId).emit("usersOnline", meetUsers);
  });

  socket.on("sendMessage", (meetId: string, payload: ChatMessagePayload) => {
    const trimmed = payload?.message?.trim();
    if (!trimmed) return;

    const outgoing = {
      userId: payload.userId,
      message: trimmed,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    io.to(meetId).emit("newMessage", outgoing);
  });

  socket.on("disconnect", async (userId: string, meetId: string) => {
    const meetUsers = await request<UserWithSocketId[]>({
      method: "POST",
      endpoint: `/api/meetings/removeUser/${meetId}`,
      data: { userId: userId },
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

    io.to(meetId).emit("usersOnline", meetUsers);
  });
});

io.listen(port);
