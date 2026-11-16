# Future ideas and fixes

## Bugs

- when refining slide transitions, i cant see objects outside bounds of frame for wiring up morph stuff from offscreen elements
  - i should be able to zoom out below 100% in this view as well
  - the look a like morph stuff should also try to line up things that were off screen and are on screen on the next slide and vice versa for morphing purposes as well.

- text inside code block content is a little messed up right now, the formatting is all off and spacing is strange.
  - as a side note some languages cnat be formatted (css as an example). I would like all languages to be formattable, maybe using prettier or something

- having trouble copy and pasting from one slide to another. I can alt drag objects to clone them out of one presentation to the canvas, then move them into a second presentation, but can move them directly sometimes

- when copying from one slide and pasting on another, it should be in the same position it was copied from on the new slide

- Typing inside shapes and slide placeholders is strange.
  - For shapes the text bounding box should be closer to a normal text bounding box with the same wrapping logic, rich text and what not. Just have wrapping on, text centered and the bounds scaled in from the edges of the shape by default.
  - for placeholders on slides, the bounds are not matching the text sometimes (its matching the placeholder text) so editing the text is a little finicky on where i double click to start editing

- Spacing/Alignment Guides
  - when moving multiple items inside a slide frame, it should add snapping for even spacing from the edges of the frame (i.e. i have to rectangles on either side of the frame, i should be able to move one left and right and get it as far from its closest edge as objects close to the opposite edges)

- setting Font Size, Lineheight, etc... on placeholder text in a layout, is not reflected on slide using said layout.
  - differences in these from the placeholder text should trigger the reset to layout
  - i would also like better ways to increase spacing between bullets and numbered lists without changing lineheight. This goes for all text not just slides.

- i want to be able to copy rows/cells from one grid table to the next
  - it should be able to create new rows automatically on paste

## Features

- Improved code editing
  - holding alt and arrow down/up to duplicate line(s)
  - shift and arrow down/up to move line(s)
  - easier ways to scale text up when resizing
  - renaming file extension should auto change language

- Live Frames
  - it would be cool if i could put an iframe into a presentation of the canvas by supplying the url i want to embed. This way i could have a project running locally and demo without having to leave the site (would need to think about cors for this but supporting localhost urls shouldnt be that hard)
  - Might also need to consider how this works when sharing a project
  - maybe localhost urls just dont work for people that were shared the link
  - maybe we need a message when viewing a project that was shared with you denoting there are live frames that may not work, or the option to opt out and render a fallback block in place for the person viewing

- Smart guidelines, minmap minimized, snap to grid, all should be persisted to the db so its not lost on local storage clearing

- add triangle to shapes

- ability to add icons to canvas (might need to curate lists of icons)

## Large Features

- OAuth
  - being able to sign in to the UI and/or mcp through thing like google, github etc... would be useful

- Fully local desktop app
  - i would like to use electron to make the app runnable fully locally
  - this app would need to be able to install new versions automatically or manually with prompts to the user if the user is not completely offline
  - it would also be nice to have some sort of "cloud" option where you can have stuff locally and push it out to the normal prod sqlite database we are hosting, or some external sqlite database the person running locally is hosting. That way you can get the benefits of running locally but sharing data between devices if you want to host it yourself or just dont want to use the web app in a browser.

- Would be nice to integrate an ai assistant that you can connect to your personal claude, chatgpt, etc... for interacting with the project through the mcp.
  - i dont want to host my own llm, i just want to allow users to provide there access tokens and connect to the mcp through the UI. I dont want to store any accesstokens, keep it in local storage and if its lost they need to reconnect from the client, that way there less security concerns.

- marketplace (slide themes and layouts, projects templates, etc...)
  - probably would need some rating system and number of downloads to help people rank things for searching and what not
  - dont want this to be a paid thing, just a way for people to share templates and what not
  - downloaded templates should be persisted to the user so they can use them in any of there projects
  - might want some versioning thing so a person can update their shared template without affected peoples projects who are using an earlier version

- Licensing
  - we need to figure out how we will license this. A tiered subscription model where higher tiers have more access to tooling, collaboration, size of projects and what not may be nice.
