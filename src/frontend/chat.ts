import socketIo from "socket.io-client";
import * as chatKeys from "../shared/chat-key";
import type { ChatMessageWithUser } from "../backend/types/types";

const socket = socketIo();

const listing = document.querySelector<HTMLDivElement>("#message-listing")!;
const form = document.querySelector<HTMLFormElement>("#message-submit")!;
const input = document.querySelector<HTMLInputElement>("#message-submit input")!;
const button = document.querySelector<HTMLButtonElement>("#message-submit button")!;
const messageTemplate = document.querySelector<HTMLTemplateElement>("#template-chat-message")!;

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

const appendMessage = (payload: { username: string; created_at: string | Date; message: string }) => {
  const { username, created_at, message } = payload;

  const clone = messageTemplate.content.cloneNode(true) as DocumentFragment;

  const timeSpan = clone.querySelector(".message-time");
  timeSpan!.textContent = formatTimeAgo(created_at);

  const usernameSpan = clone.querySelector(".message-username");
  usernameSpan!.textContent = username;

  const msgSpan = clone.querySelector(".message-text");
  msgSpan!.textContent = message;

  listing.appendChild(clone);
  // Scroll to bottom
  listing.scrollTop = listing.scrollHeight;
};

// Load initial messages

socket.on(chatKeys.CHAT_LISTING, ({ messages }: { messages: ChatMessageWithUser[] }) => {
  messages.forEach((message) => {
    appendMessage(message);
  });

  // Scroll to bottom after loading messages
  listing.scrollTop = listing.scrollHeight;
});


// Listen for new messages
socket.on(
  chatKeys.CHAT_MESSAGE,
  // server emits `{ message: ChatMessage }` but some callers may emit the raw ChatMessage
  (payload: { message: ChatMessageWithUser } | ChatMessageWithUser) => {
    console.log(chatKeys.CHAT_MESSAGE, payload);

    // normalize payload: prefer `payload.message` if present
    const msg = (payload as any).message ?? (payload as ChatMessageWithUser);

    appendMessage(msg);
    // Scroll to bottom when a new message arrives
    listing.scrollTop = listing.scrollHeight;
  }
);

// Handle form submission
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!input.value.trim()) return;

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input.value,
        }),
      });

      if (response.ok) {
        input.value = "";
      } else {
        console.error("Failed to send message");
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  });
}
