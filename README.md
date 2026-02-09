# trello-sort-by-members

A Trello Power-Up that adds custom list sorting by members and a "Copy as Template..." list action that copies a list with adjusted due dates.

## Setup

1. Register a Power-Up at https://trello.com/power-ups/admin and get your API key
2. Copy the config template and add your key:
   ```
   cp js/config.example.js js/config.js
   ```
3. Edit `js/config.js` and replace `YOUR_APP_KEY_HERE` with your API key
4. Serve the files over HTTPS (e.g., `npx http-server ./ -p 8080` + `ngrok http 8080`)
5. Set the connector URL in the Power-Up admin portal to your HTTPS URL
6. Enable the Power-Up on a board
