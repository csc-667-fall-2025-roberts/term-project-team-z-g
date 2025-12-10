import { loadGames } from "./lobby/load-games";

document.addEventListener("DOMContentLoaded", () => {
  // Load available games on lobby page load
  loadGames();
  
  // Set up create game button handler
  const createGameButton = document.querySelector("#create-game-button");
  if (createGameButton) {
    createGameButton.addEventListener("click", async () => {
      try {
        const response = await fetch("/games", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        });
        
        if (response.ok) {
          // Reload games list after creating
          await loadGames();
        }
      } catch (error) {
        console.error("Error creating game:", error);
      }
    });
  }
});
