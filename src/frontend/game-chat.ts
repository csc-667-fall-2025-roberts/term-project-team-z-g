import socketIo from "socket.io-client";
import { GAME_CHAT_MESSAGE, GAME_CHAT_LISTING } from "../shared/keys";

const socket = socketIo();

const formatTimeAgo = (date: Date | string): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
};

const appendGameMessage = (payload: { username: string; created_at: string | Date; message: string }) => {
  const { username, created_at, message } = payload;
  
  const messageTemplate = document.querySelector<HTMLTemplateElement>("#game-message-template");
  if (!messageTemplate) return;

  const clone = messageTemplate.content.cloneNode(true) as DocumentFragment;

  const timeSpan = clone.querySelector(".message-time") as HTMLElement;
  const time = new Date(created_at);
  if (timeSpan) {
    timeSpan.textContent = formatTimeAgo(time);
    timeSpan.dataset.timestamp = time.getTime().toString();
  }

  const usernameSpan = clone.querySelector(".message-username") as HTMLElement;
  if (usernameSpan) {
    usernameSpan.textContent = username;
  }

  const msgSpan = clone.querySelector(".message-text") as HTMLElement;
  if (msgSpan) {
    msgSpan.textContent = message;
  }

  const listing = document.querySelector("#game-message-listing");
  if (listing) {
    listing.appendChild(clone);
    listing.scrollTop = listing.scrollHeight;
  }
};

const updateAllTimestamps = () => {
  const listing = document.querySelector("#game-message-listing");
  if (!listing) return;
  
  const timestamps = listing.querySelectorAll(".message-time");
  timestamps.forEach((el: Element) => {
    const timestamp = parseInt((el as HTMLElement).dataset.timestamp || "0");
    if (timestamp) {
      (el as HTMLElement).textContent = formatTimeAgo(new Date(timestamp));
    }
  });
};

// Update timestamps every 10 seconds
setInterval(updateAllTimestamps, 10000);

export const initGameChat = (gameId: number) => {
  console.log("initGameChat called with gameId:", gameId);
  
  // Join the game room
  socket.emit("join-game", { gameId });
  console.log("Emitted join-game event");

  // Load chat history
  fetch(`/games/${gameId}/chat`, {
    method: "GET",
    credentials: "include",
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("Fetched chat history JSON:", data);
      if (data?.messages?.length) {
        const listing = document.querySelector("#game-message-listing");
        if (listing) {
          listing.innerHTML = "";
          data.messages.forEach((msg: any) => appendGameMessage(msg));
        }
      }
    })
    .catch((err) => console.error("Error loading chat history:", err));
  console.log("Fetching chat history...");

  // Listen for chat history
  socket.on(GAME_CHAT_LISTING, ({ messages }: { messages: any[] }) => {
    console.log("Received GAME_CHAT_LISTING:", messages);
    const listing = document.querySelector("#game-message-listing");
    if (listing) {
      listing.innerHTML = '';
      messages.forEach((msg) => {
        appendGameMessage(msg);
      });
    }
  });

  // Listen for new messages
  socket.on(GAME_CHAT_MESSAGE, (payload: any) => {
    console.log("Received GAME_CHAT_MESSAGE:", payload);
    appendGameMessage(payload);
  });

  // Handle message sending
  const form = document.querySelector<HTMLFormElement>("#game-chat-form");
  const input = document.querySelector<HTMLInputElement>("#game-chat-input");

  console.log("Form element:", form);
  console.log("Input element:", input);

  if (form && input) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("Form submitted");
      
      const message = input.value.trim();
      console.log("Message to send:", message);
      if (!message) return;

      try {
        const response = await fetch(`/games/${gameId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ message }),
        });

        console.log("Response status:", response.status);
        if (response.ok) {
          const data = await response.json();
          console.log("Response data:", data);
          // Show the message optimistically
          appendGameMessage({
            username: data.username || "You",
            message: data.message,
            created_at: data.created_at,
          });
          input.value = "";
        } else {
          console.error("Failed to send message");
        }
      } catch (err) {
        console.error("Error sending message:", err);
      }
    });
  }
};
