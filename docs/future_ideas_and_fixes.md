# Future ideas and fixes

## Bugs

- morphing issues
  - morphing from code block to code block doesnt respect words, characters, objects well
    - we may need an overall audit on morphing with the "animate text by" to make sure it works correctly for various objects. May want to rename to "animate by" instead as well.
  - preview for non morph transitions doesnt work or make sense
    - in fact i kindve want to be able to morph elements with individual "animate by" while making the slide transition overall none, fade, slide, or zoom. a.k.a morph is built in and can be opted out of separately per element
  - when i have a code block on one slide, morph to a code block on next slide, but also have a code block on top of that codeblock on slide two, the zindex is incorrect while the transition runs, then snaps to the right spot.

- slide issue
  - i want to be able to pan around the empty area around a slide to edit things that go off screen of the main slide
  - some way to snap back to the slide after panning in this way would be nice

- grid tables
  - i want to be able to double click the row line or column line to snap the column to the left or row above to snap size to fit the content.
  - we also cant resize the last row or last column currently so it would be nice to be able to do this without detracting from the table resizing

- holding ctrl and resizing things like code blocks, sequence diagrams etc... should scale it up instead of just adding more whitespace. This way we can resize to scale and resize to add more space to the object without scaling.

- smart guidelines do not trigger for the outer bounds of presentation panel

- live frames
  - when typing in the input for entering a url, it is hard to see (color is light on a light input background)
  - i hate the screenshot thing. If we cant do this automatically and at a better scale lets get rid of it
  - i would like a better loading animation while we are loading the iframe. maybe a spinner with the url we are loading and a custom error screen if it fails

- mcp
  - the mcp keeps making code blocks and presentation slides without referencing the design theme colors and layouts. We should exclusively use theme color and layouts for presentations made through mcp

- the standard slide designs are still ugly. I want more variation not just random shapes. Powerpoint for example has a bunch of nice designs by default that are all significantly different.

## Features

- Improved code editing. I want to mimic some of my vscode shortcuts
  - holding alt and arrow down/up to duplicate line(s)
  - shift and arrow down/up to move line(s)
  - shift end to highlight from cursor to end of line. same for shift home
  - shift ctrl end to highlight to end of code. same for shift ctrl home
  - highlighting text, then ctrl + d to highlight next instance of that text
  - multiple cursors with ctrl clicks, alt shift drag over multiple lines, or above ctrl + d

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
