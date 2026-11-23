# Future ideas and fixes

## Bugs

- when a project link is shared, i want to be able to keep shared projects accessible in the projects dialog (maybe a separate section or tag) until its revoked. When opening the project dialog, fetch to see if its still a valid link or the fetch for the list of projects does this on the backend already. this way once i open the link, if im already logged in, when i come back later i dont have to refind the shared link

## Features

- ability to add icons to canvas (might need to curate lists of icons)

- interactive tour
  - multiple tours would be nice around each individual tool (maybe triggered from our guide or something, id want a full canvas instead but maybe the trigger is from the guides)
  - specifically presentations should be explained fully around design layouts, themes, animations, morphing, etc...

## Large Features

- marketplace (slide themes and layouts, projects templates, etc...)
  - probably would need some rating system and number of downloads to help people rank things for searching and what not
  - dont want this to be a paid thing, just a way for people to share templates and what not
  - downloaded templates should be persisted to the user so they can use them in any of there projects
  - might want some versioning thing so a person can update their shared template without affected peoples projects who are using an earlier version

- Licensing
  - we need to figure out how we will license this. A tiered subscription model where higher tiers have more access to tooling, collaboration, size of projects and what not may be nice.
  - Plan drafted in [licensing-plan.md](licensing-plan.md): Guest/Free/Pro ($6/mo, $60/yr)/Team tiers, weekly MCP write quota for Free, merchant-of-record payments, implementation checklist.

- Different database support
  - currently we use sqlite. I think this is exceptional correct for desktop app running locally. I would like to be able to swap out the db for mysql or postgres in the future. Especially for people who want to host there own remote servers.
  - we should make a plan for bringing your own db as well as your own server if possible
  - similarly bringing your own file hosting would be nice
