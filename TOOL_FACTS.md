---
tool_facts_version: "0.1.0"
name: DictaWhisper MCP Server
developer: Catalyst Forge
version: "0.0.3"
status: active
license: Apache-2.0
kind: mcp-server
homepage: https://dictawhisper.com
repository: https://github.com/Catalyst-Forge-LLC/dictawhisper
runtime:
  execution: local-process
  transport: stdio
credentials:
  required: []
egress:
  telemetry: none
  destinations: []
tools:
  - name: dictawhisper_search
    purpose: "Search voice notes by words, tags, or filename; returns paths, dates, tags, and a short preview"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
  - name: dictawhisper_get_note
    purpose: "Fetch one note by sidecar path or unique basename; returns cleaned text and tags"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
  - name: dictawhisper_list_tags
    purpose: "List tags in the journal with counts"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
  - name: dictawhisper_recent
    purpose: "List newest notes first with optional tag and day range filters"
    side_effects: read
    reach:
      filesystem: scoped
      network: none
      processes: false
    idempotent: true
generated:
  date: 2026-08-20
  generator: hand-authored (tools inventory from dictawhisper mcp (read-only journal))
credits:
  generated_with: https://toolfacts.dev
  built_by: "Catalyst Forge - https://www.catalystforge.com/"
---

# Tool Facts - DictaWhisper MCP Server

| | |
|---|---|
| **Developer** | Catalyst Forge |
| **Version** | 0.0.3 |
| **Status** | active |
| **License** | Apache-2.0 |
| **Kind** | mcp-server |

## Runtime

| | |
|---|---|
| Execution | local-process |
| Transport | stdio |

## Credentials

None required.

## Egress

| | |
|---|---|
| Telemetry | none |
| Destinations | (none) |

## Tools (4)

| Tool | Side effects | Filesystem | Network | Processes | Idempotent |
|---|---|---|---|---|---|
| `dictawhisper_search` | read | scoped | none | no | yes |
| `dictawhisper_get_note` | read | scoped | none | no | yes |
| `dictawhisper_list_tags` | read | scoped | none | no | yes |
| `dictawhisper_recent` | read | scoped | none | no | yes |

**Purpose lines**

| Tool | Purpose |
|---|---|
| `dictawhisper_search` | Search voice notes by words, tags, or filename; returns paths, dates, tags, and a short preview |
| `dictawhisper_get_note` | Fetch one note by sidecar path or unique basename; returns cleaned text and tags |
| `dictawhisper_list_tags` | List tags in the journal with counts |
| `dictawhisper_recent` | List newest notes first with optional tag and day range filters |

---
*Generated with [ToolFacts](https://toolfacts.dev) · Built by [Catalyst Forge](https://www.catalystforge.com/)*
