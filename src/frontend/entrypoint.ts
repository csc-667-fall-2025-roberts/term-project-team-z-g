import "./game";
import "./chat";
import "./lobby";
import { initGameChat } from "./game-chat";

// Initialize based on current page
const currentPath = window.location.pathname;

if (currentPath === "/lobby") {
  // Lobby page logic is handled in lobby.ts
  console.log("Lobby page loaded");
} else if (currentPath.startsWith("/games/")) {
  // Game page logic - initialize game chat after DOM is ready
  console.log("Game page loaded");

  const startGameChat = () => {
    const match = currentPath.match(/\/games\/(\d+)/);
    if (match) {
      const gameId = parseInt(match[1]);
      initGameChat(gameId);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startGameChat, { once: true });
  } else {
    startGameChat();
  }
}
