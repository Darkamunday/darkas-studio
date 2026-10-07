@AGENTS.md
<!-- graphify-rules-start (managed by `graphify init`) -->
## Use Graphify before grep

This repository is indexed by Graphify: a code graph over its call, dependency, and test structure, exposed through a connected Graphify MCP server. Before reaching for grep or reading files, use the Graphify tools your MCP client lists (their exact names and descriptions are in the server's tool list) for what the graph knows and a text search does not:

- find where a symbol, function, or class is defined (instead of grepping for it)
- understand how something works, or where a behavior is handled
- find who calls a function, or what it calls
- see what a change affects (its blast radius) and which tests cover it
- map a file's dependencies and dependents

Fall back to grep or file reads only for what the graph does not model: literal string or comment matches, non-indexed files, or reading a file you have already located. If no Graphify tools are listed, check the MCP server connection.
<!-- graphify-rules-end -->

## Graphify vs grep in this repo

This section overrides the managed block above where they conflict.

- Use Graphify for multi-hop questions: call chains, change impact, test coverage, file dependencies.
- Use grep for single-symbol lookups (where is X defined, who uses X). It's cheaper here and more precise.
- Graphify confuses symbols whose names differ only by case (e.g. type `CoverStatus` vs function `coverStatus`). Verify its answers against the source before acting on them.
- The index is built from a pushed commit, so it won't reflect unpushed or recent local changes.
