---
tool_facts_version: "0.1.0"
name: DictaWhisper MCP Server
developer: Catalyst Forge
version: "0.0.13"
status: active
license: MIT
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
  date: 2026-09-10
  generator: hand-authored (tools inventory from dictawhisper mcp 0.0.9, read-only journal)
credits:
  generated_with: https://toolfacts.dev
  built_by: "Catalyst Forge - https://www.catalystforge.com/"
---

# Tool Facts - DictaWhisper MCP Server

| | |
|---|---|
| **Developer** | Catalyst Forge |
| **Version** | 0.0.13 |
| **Status** | active |
| **License** | MIT |
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

[toolfacts-label]: https://toolfacts.dev/v#tf1.eNrFlE9rGzEQxb-KmLOcpMdujymBggOFFHoIwSja5101u5IyM7uOMf7uZdZx_9Gcc9JBT_PebyTNgWZqPnjKYQQ19DlFDd_7JBXsbq-_ujvwDCZPLWYMpYKpoeugYdiLupvCHcjTDJZUMjV0dXF18ZE8iQadhBoKUdNsmiFFZDGT2y_fyNNTyi01NMa6krMJT1mTBTkQXhAnPRUdSgzDqnKJECFPyiFLLazUkGibCh09RUaLrCkMYucZz1NitNTcPxw9oWM72xxIMWCE8p4ayiVjYRNNOZibvOq1FKtzfzh3prXO7E6d2QgCx94wU4sNtltENVhGaA0DIfbmtU0DZC-K0ZLGUmHbGbor_PTb_5UMQs02DIKjp9RirEWRlRrlCZ7qxLUs_btb3N1cUoTLRSHuce92hVvxTkMn3hV25m3ZPzmGTpzF1aC9eNcGxS9hyK0LTvrC6ipjTtjR0f-fuoNuzO69uG-gsXcln6CN2WLEwAuZMU85PU9wj0H-QY8DQkbrFC-6MBv9m6BDEt0sinciXSfRJaJL2WkP96NMnMPgdkl7F8uU9e30jGhF3zN6xg62LG9zm1j0lLxU-2NhMLblGtqwdxxyB3uuChY6Pnjqy4gaOivXq1ZpLi__JLyIZVxAapGkZfnJZ12XtJ8eTXF5nlKrZUqt1uvrv6osc2TKMagNCcM4_gRh38d-
