---
title: MCP
---

Agents can search the journal without managing it. `pnpm mcp` is a stdio server over the same sidecar files. No writes. The API does not need to be running.

## Tools

| Tool | What it does |
|---|---|
| `dictawhisper_search` | Search notes |
| `dictawhisper_get_note` | Fetch one sidecar |
| `dictawhisper_list_tags` | List tags |
| `dictawhisper_recent` | Recent notes |

This repo ships `.cursor/mcp.json`. Elsewhere:

```json
{
  "mcpServers": {
    "dictawhisper": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/mcp.ts"],
      "cwd": "/absolute/path/to/dictawhisper"
    }
  }
}
```
