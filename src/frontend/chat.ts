import socketIo from "socket.io-client";
import * as chatKeys from "../shared/chat-key";
import type { ChatMessageWithUser } from "../backend/types/types";

const socket = socketIo();

const listing = document.querySelector<HTMLDivElement>("#message-listing")!;
const form = document.querySelector<HTMLFormElement>("#message-submit")!;
const input = document.querySelector<HTMLInputElement>("#message-submit input")!;
const button = document.querySelector<HTMLButtonElement>("#message-submit button")!;
const messageTemplate = document.querySelector<HTMLTemplateElement>("#template-chat-message")!;

const appendMessage = (payload: { username: string; created_at: string | Date; message: string }) => {
  const { username, created_at, message } = payload;

  const clone = messageTemplate.content.cloneNode(true) as DocumentFragment;

  const timeSpan = clone.querySelector(".message-time");
  const time = new Date(created_at);
  timeSpan!.textContent = time.toLocaleTimeString();

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
  console.log(chatKeys.CHAT_LISTING, { messages });

  // Clear placeholder
  listing.innerHTML = '';
  
  messages.forEach((message) => {
    appendMessage(message);
  });
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

