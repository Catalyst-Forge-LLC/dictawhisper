---
title: MCP
---

Agents can search the journal without managing it. `pnpm mcp` is a stdio server. Search and tags use `data/journal.sqlite` (FTS5 + sqlite-vec) when that file has rows; otherwise it walks sidecars. No journal-content writes; opening the derived index can migrate its cache schema. The API does not need to be running. Rebuild with `pnpm journal:index`.

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

## Current compatibility

Existing search/get/recent/tag tools remain available. Sidecars may now include `entryId`, `displayTitle`, `recordedDate` and date provenance, MayDos and their status/extraction metadata. Legacy sidecars remain readable. MCP uses its existing capped read-only tool contracts; HTTP `page=1` provides UI pagination and is not an implicit change to MCP inputs.

Settings → Integrations supplies the executable path, source or packaged MCP entry point, and loaded `DICTA_CONFIG` for this installation. ExoMetaCortex synchronization is planned; no export or automatic sync is connected yet.
