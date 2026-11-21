# Future ideas and fixes

## Bugs

- morph tags should be able to be adding while editing master and layout slides on designs

## Features

- we should combine animations and transitions. no need for both to be separate tabs
  - animations should be able to be set up in their own refine section as well
    - per element, ordering, with previous, on click start options, same effects as and types that exist, but additionally some way to stagger animations easily for things like bullets in a text block animate in/out one after the other.
  - transition should work based on the ending state of the previous slide and the starting state of the next
  - code blocks with diffs should default to have an animation where they show the original, then the diff after a click or arrow/space key. This way adding a codeblock with a diff to a slide automatically presents with both states and can morph between them. Should be able to be turned off with animation refinment. this may need to be a special animation type or something only for code blocks
  - similarly sequence diagrams should default to have an animation where they show the each message one by one, after a click or arrow/space key. Should be able to be turned off with animation refinment. Also may want multiple messages to come in at the same time so some sort of grouping may be nice as well. This may need to be a special animation type or something only for code blocks

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
