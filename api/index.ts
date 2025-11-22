import { Server, type Socket } from "socket.io";
import "dotenv/config";

const origins = (process.env.ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server({
  cors: { origin: origins },
});

const port = Number(process.env.PORT);

type User = {
  socketId: string;
  userId: string;
};

type ChatMessagePayload = {
  userId: string;
  message: string;
  timestamp?: string;
};

const meets: Record<string, User[]> = {};

io.on("connection", (socket: Socket) => {
  console.log("New connection:", socket.id);

  socket.on("joinMeet", (meetId: string) => {
    if (!meetId) return;

    const userList = meets[meetId] ?? [];

    if (userList.length >= 2) {
      socket.emit("meetFull");
      return;
    }

    meets[meetId] = [...userList, { socketId: socket.id, userId: "" }];
    socket.join(meetId);

    io.to(meetId).emit("usersOnline", meets[meetId]);
    console.log("User joined meet:", meetId, meets[meetId]);
  });

  socket.on("newUser", (meetId: string, userId: string) => {
    if (!meetId || !userId) return;

    const users = meets[meetId];
    if (!users) return;

    meets[meetId] = users.map((u) =>
      u.socketId === socket.id ? { socketId: socket.id, userId } : u,
    );

    io.to(meetId).emit("usersOnline", meets[meetId]);
  });

  socket.on("sendMessage", (meetId: string, payload: ChatMessagePayload) => {
    const trimmed = payload?.message?.trim();
    if (!trimmed) return;

    const users = meets[meetId] ?? [];

    const sender = users.find((u) => u.socketId === socket.id);

    const outgoingMessage = {
      userId: payload.userId || sender?.userId || socket.id,
      message: trimmed,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    io.to(meetId).emit("newMessage", outgoingMessage);
  });

  socket.on("disconnect", () => {
    for (const meetId of Object.keys(meets)) {
      const before = meets[meetId].length;

      meets[meetId] = meets[meetId].filter((u) => u.socketId !== socket.id);

      const after = meets[meetId].length;

      if (before !== after) {
        io.to(meetId).emit("usersOnline", meets[meetId]);
        console.log("User disconnected from meet", meetId);
      }

      if (meets[meetId].length === 0) {
        delete meets[meetId];
      }
    }
  });
});

io.listen(port);
console.log(`Server running on port ${port}`);
