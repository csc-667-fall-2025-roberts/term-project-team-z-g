const button: Element | null = document.querySelector("#test-button");

button?.addEventListener("click", (event) => {
    event.preventDefault();

    setTimeout(() => {
        alert("You clicked around 1 seconds ago!");
    }, 1000);
});