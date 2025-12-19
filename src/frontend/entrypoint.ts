import "./game";
import "./chat";
import "./lobby";

// Initialize based on current page
const currentPath = window.location.pathname;

if (currentPath === "/lobby") {
  // Lobby page logic is handled in lobby.ts
  console.log("Lobby page loaded");
} else if (currentPath.startsWith("/games/")) {
  // Game page logic will be added here
  console.log("Game page loaded");
}
