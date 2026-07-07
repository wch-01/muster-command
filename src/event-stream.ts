import type { ServerResponse } from "node:http";

const clients = new Set<ServerResponse>();

export const addEventStreamClient = (response: ServerResponse) => {
  clients.add(response);
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  response.write("event: ready\ndata: {}\n\n");

  response.on("close", () => {
    clients.delete(response);
  });
};

export const notifyEventsChanged = () => {
  const payload = `event: events-changed\ndata: {"at":${Date.now()}}\n\n`;
  for (const client of clients) {
    if (client.destroyed || client.writableEnded) {
      clients.delete(client);
      continue;
    }

    try {
      client.write(payload);
    } catch (error) {
      clients.delete(client);
      console.error("Failed to notify event stream client:", error);
    }
  }
};
