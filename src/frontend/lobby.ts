import { loadGames } from "./lobby/load-games";

document.addEventListener("DOMContentLoaded", () => {
  // Load available games on lobby page load
  loadGames();
  
  // Set up create game button handler
  const createGameButton = document.querySelector("#create-game-button");
  if (createGameButton) {
    createGameButton.addEventListener("click", async () => {
      try {
        const gameName = (document.querySelector("#game-name") as HTMLInputElement)?.value || "New Game";
        const maxPlayersInput = document.querySelector("#max-players") as HTMLInputElement;
        const maxPlayers = parseInt(maxPlayersInput?.value || "4", 10);
        
        const response = await fetch("/games", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: gameName,
            max_players: maxPlayers,
          }),
        });
        
        if (response.ok) {
          // Reset form and reload games list after creating
          if (document.querySelector("#game-name") as HTMLInputElement) {
            (document.querySelector("#game-name") as HTMLInputElement).value = "Friday Night Rummy";
          }
          if (maxPlayersInput) {
            maxPlayersInput.value = "4";
          }
          await loadGames();
        } else {
          const error = await response.text();
          alert("Error creating game: " + error);
        }
      } catch (error) {
        console.error("Error creating game:", error);
        alert("Failed to create game");
      }
    });
  }
});
