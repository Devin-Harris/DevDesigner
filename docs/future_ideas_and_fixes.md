# Future ideas and fixes

## Bugs

## Features

- ability to add icons to canvas (might need to curate lists of icons)

- interactive tour
  - multiple tours would be nice around each individual tool (maybe triggered from our guide or something, id want a full canvas instead but maybe the trigger is from the guides)
  - specifically presentations should be explained fully around design layouts, themes, animations, morphing, etc...

## Large Features

- OAuth
  - being able to sign in to the UI and/or mcp through thing like google, github etc... would be useful

- marketplace (slide themes and layouts, projects templates, etc...)
  - probably would need some rating system and number of downloads to help people rank things for searching and what not
  - dont want this to be a paid thing, just a way for people to share templates and what not
  - downloaded templates should be persisted to the user so they can use them in any of there projects
  - might want some versioning thing so a person can update their shared template without affected peoples projects who are using an earlier version

- Licensing
  - we need to figure out how we will license this. A tiered subscription model where higher tiers have more access to tooling, collaboration, size of projects and what not may be nice.

- Different database support
  - currently we use sqlite. I think this is exceptional correct for desktop app running locally. I would like to be able to swap out the db for mysql or postgres in the future. Especially for people who want to host there own remote servers.
  - we should make a plan for bringing your own db as well as your own server if possible
  - similarly bringing your own file hosting would be nice
