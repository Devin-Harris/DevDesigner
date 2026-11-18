# Future ideas and fixes

## Bugs

...

## Features

<!-- - Improved code editing. I want to mimic some of my vscode shortcuts
  - holding alt and arrow down/up to duplicate line(s)
  - shift and arrow down/up to move line(s)
  - shift end to highlight from cursor to end of line. same for shift home
  - shift ctrl end to highlight to end of code. same for shift ctrl home
  - highlighting text, then ctrl + d to highlight next instance of that text
  - multiple cursors with ctrl clicks, alt shift drag over multiple lines, or above ctrl + d -->

<!-- - Live Frames
  - it would be cool if i could put an iframe into a presentation of the canvas by supplying the url i want to embed. This way i could have a project running locally and demo without having to leave the site (would need to think about cors for this but supporting localhost urls shouldnt be that hard)
  - Might also need to consider how this works when sharing a project
  - maybe localhost urls just dont work for people that were shared the link
  - maybe we need a message when viewing a project that was shared with you denoting there are live frames that may not work, or the option to opt out and render a fallback block in place for the person viewing
  - it would be nice to integrate this into the frame tool that exists, when exporting to pdf or images a screenshot of the frame at the point in time would suffice -->

- Smart guidelines, minmap minimized, snap to grid, all should be persisted to the db so its not lost on local storage clearing

- add triangle to shapes

- ability to add icons to canvas (might need to curate lists of icons)

## Large Features

- OAuth
  - being able to sign in to the UI and/or mcp through thing like google, github etc... would be useful

<!-- - Fully local desktop app
  - i would like to use electron to make the app runnable fully locally
  - this app would need to be able to install new versions automatically or manually with prompts to the user if the user is not completely offline
  - it would also be nice to have some sort of "cloud" option where you can have the app running locally and push saved data out to the normal prod sqlite database we are hosting, or even better a custom external sqlite database the person running locally is hosting themselves (then we wouldnt have to supply 1 server instance for everyone who wants to use devdesigner). That way you can get the benefits of running locally but sharing data between devices if you want to host it yourself or just dont want to use the web app in a browser. -->

- Would be nice to integrate an ai assistant that you can connect to your personal claude, chatgpt, etc... for interacting with the project through the mcp.
  - i dont want to host my own llm, i just want to allow users to provide there access tokens and connect to the mcp through the UI. I dont want to store any accesstokens, keep it in local storage and if its lost they need to reconnect from the client, that way there less security concerns.
  - we may want to audit the mcp a little to make sure we can efficiently interact with the canvas, projects and all available elements.

- marketplace (slide themes and layouts, projects templates, etc...)
  - probably would need some rating system and number of downloads to help people rank things for searching and what not
  - dont want this to be a paid thing, just a way for people to share templates and what not
  - downloaded templates should be persisted to the user so they can use them in any of there projects
  - might want some versioning thing so a person can update their shared template without affected peoples projects who are using an earlier version

- Licensing
  - we need to figure out how we will license this. A tiered subscription model where higher tiers have more access to tooling, collaboration, size of projects and what not may be nice.
