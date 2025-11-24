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

type ActiveUser = {
  userId: string;
  socketId: string;
};

type Meeting = {
  userId: string | null;
  socketId: string | null;
  description: string | null;
  is_active: boolean | null;
  active_users: ActiveUser[];
  startAt: string | null;
  finishAt: string | null;
  createdAt: string | null;
};

type BackendError = { error: string };

io.on("connection", (socket: Socket) => {
  socket.on("joinMeet", async (userId: string, meetId: string) => {
    if (!meetId || !userId) return;

    const meet = await request<Meeting | BackendError>({
      method: "GET",
      endpoint: `/meets/${meetId}`,
    });

    if (!meet || "error" in meet) {
      socket.emit("error", {
        origin: "joinMeet",
        message: meet && "error" in meet ? meet.error : "Error inesperado",
      });
      return;
    }

    if (meet.active_users.length >= 10) {
      socket.emit("meetFull");
      return;
    }

    const meetUsers = await request<ActiveUser[] | BackendError>({
      method: "PUT",
      endpoint: `/meetings/addUser/${meetId}`,
      data: { userId: userId, socketId: socket.id },
      headers: { "Content-Type": "application/json" },
    });

    if (!meetUsers || "error" in meetUsers) {
      socket.emit("error", {
        origin: "joinMeet",
        message:
          meetUsers && "error" in meetUsers
            ? meetUsers.error
            : "Error inesperado",
      });
      return;
    }

    socket.join(meetId);

    io.to(meetId).emit("usersOnline", meetUsers);
  });

  socket.on("newUser", async (meetId: string, userId: string) => {
    if (!meetId || !userId) return;

    const updatedUser = await request<ActiveUser | BackendError>({
      method: "PUT",
      endpoint: `/meetings/updateMeetingUser/${meetId}`,
      data: { userId, socketId: socket.id },
      headers: { "Content-Type": "application/json" },
    });

    if (!updatedUser || "error" in updatedUser) {
      socket.emit("error", {
        origin: "joinMeet",
        message:
          updatedUser && "error" in updatedUser
            ? updatedUser.error
            : "Error inesperado",
      });
      return;
    }

    const meetUsers = await request<ActiveUser[] | BackendError>({
      method: "GET",
      endpoint: `/meets/getMeetingUsers/${meetId}`,
    });

    if (!meetUsers || "error" in meetUsers) {
      socket.emit("error", {
        origin: "joinMeet",
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
    const meetUsers = await request<ActiveUser[]>({
      method: "POST",
      endpoint: `/meetings/removeUser/${meetId}`,
      data: { userId: userId },
      headers: { "Content-Type": "application/json" },
    });

    if (!meetUsers || "error" in meetUsers) {
      socket.emit("error", {
        origin: "joinMeet",
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
