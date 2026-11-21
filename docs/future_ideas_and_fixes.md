# Future ideas and fixes

## Bugs

- i should be able to change spacing between bullets when wrapping is on
- i should be able to double click the spacing lines between bullets and reset the spacing back to default

- when editing text, especially placeholder on slides, the bounds dont line up. for example double clicking on some text start a new text block because i needed to click the first line of text
  i also see pressing enter puts the cursor on the next line but doesnt update the bounds right away

- when dragging the overflow handles for text, they should particpate in the smart guidelines with other elements, and with the spacing of slide edges

- when installing the desktop app, the electron icon is in the taskbar, windows menu, and task manager, we should be using the same branding everywhere which eventually i will change

- alt dragging text from one slide to another, does not keep its heading/body text, it forces it to its font

- code diffs are all messed up. Both in the highlighting and in the editing while inline and side by side. Things like shift end, left and right arrows, etc... get messed up and i end up editing the wrong thing.
  also mcp struggles to use this feature
  - highlighting two code blocks, then holding ctrl and resizing should scale both at the same time. This should work for other multi selected objects as well, but i just noticed it with code blocks
  - formatting with a code diff side by side doesnt try to format the code into the bounds like it does without a diff. I want this so i can set the width size, format to try to fit the code in that size, and resize the height if necessary
    it seems this may be related to top level imports of ts files can be broken onto multiple lines? that may be nice to allow (maybe a wrapping feature like text blocks have). in general the errors for failed formatting is hard to understand especially with diffs, maybe some red squiggles to help illustrate it better
  - turning diff off multiple code blocks at once duplicates some codeblocks
  - diff highlighting doesnt morph right, it should move and fade in with the text, not fade in from its final position as text is moving to it

- slide selected, hold shift, select another slide 3 slides away, slides in between should be selected so all can be edited together. Currently behaves like ctrl click by selected both slides not the range of slides

- undo/redo does not work in a lot of situations. we need a full audit so that we can properly undo and redo sets and individual changes for all different types of objects with moving, resizing, editing, deleteing and etc...
  - moving multiple sequence diagrams at once
  - editing text stroke inside a shape
  - many others

## Features

- ctrl + shift + e should export selection

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

- it would be nice to have some right click context menus, i know in the examples on the home page we show right clicking to format, fit to content etc... for code blocks. Things like that and more for other objects may be a nice touch for some of the harder to get to options from the quick overlays.

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
