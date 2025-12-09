import socketIo from "socket.io-client";
import * as chatKeys from "../shared/chat-key";
import type { ChatMessageWithUser } from "../backend/types/types";

const socket = socketIo();

const listing = document.querySelector<HTMLDivElement>("#message-listing")!;
const input = document.querySelector<HTMLInputElement>("#message-submit input")!;
const button = document.querySelector<HTMLButtonElement>("#message-submit button")!;
const messageTemplate = document.querySelector<HTMLTemplateElement>("#template-chat-message")!;

const appendMessage = (payload: { username: string; created_at: string | Date; message: string }) => {
  const { username, created_at, message } = payload;

  const clone = messageTemplate.content.cloneNode(true) as DocumentFragment;

  const timeSpan = clone.querySelector(".message-time");
  const time = new Date(created_at);
  timeSpan!.textContent = time.toLocaleDateString();
  console.log(time, timeSpan);

  const usernameSpan = clone.querySelector(".message-username");
  usernameSpan!.textContent = username;
  console.log(username, usernameSpan);

  const msgSpan = clone.querySelector(".message-text");
  msgSpan!.textContent = message;
  console.log(message, msgSpan);

  listing.appendChild(clone);
};

socket.on(chatKeys.CHAT_LISTING, ({ messages }: { messages: ChatMessageWithUser[] }) => {
  console.log(chatKeys.CHAT_LISTING, { messages });

  messages.forEach((message) => {
    appendMessage(message);
  });
});

socket.on(
  chatKeys.CHAT_MESSAGE,
  // server emits `{ message: ChatMessage }` but some callers may emit the raw ChatMessage
  (payload: { message: ChatMessageWithUser } | ChatMessageWithUser) => {
    console.log(chatKeys.CHAT_MESSAGE, payload);

    // normalize payload: prefer `payload.message` if present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (payload as any).message ?? (payload as ChatMessageWithUser);

    appendMessage(msg);
  }
);

const sendMessage = () => {
  const message = input.value.trim();

  if (message.length > 0) {
    const body = JSON.stringify({ message });

    fetch("/chat/", {
      method: "post",
      body,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  input.value = "";
};

button.addEventListener("click", (event) => {
  event.preventDefault();

  sendMessage();
});

input.addEventListener("keydown", (event) => {
  if (event.key == "Enter") {
    sendMessage();
  }
});

// Load message history when page loads
fetch("/chat/", {
  method: "get",
  credentials: "include",
});

