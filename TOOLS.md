# Tools Reference

This document lists all MCP tools provided by the Dutch Data Protection MCP server (`nl_dp_` prefix).

## Tool List

| Tool | Description |
|---|---|
| `nl_dp_search_decisions` | Full-text search across AP decisions, boetes (fines), and aanbevelingen (recommendations) |
| `nl_dp_get_decision` | Retrieve a specific AP decision by reference number |
| `nl_dp_search_guidelines` | Search AP guidance documents: handleidingen, normuitleg, richtsnoeren, and beleidsregels |
| `nl_dp_get_guideline` | Retrieve a specific AP guidance document by database ID |
| `nl_dp_list_topics` | List all covered data protection topics with Dutch and English names |
| `nl_dp_about` | Return metadata about this MCP server: version, data source, coverage, and tool list |
| `nl_dp_list_sources` | List the primary data sources used by this server |
| `nl_dp_check_data_freshness` | Check data freshness: record counts and latest dates for decisions and guidelines |

## Tool Details

### `nl_dp_search_decisions`

Full-text search across AP (Autoriteit Persoonsgegevens) decisions, boetes (fines), and aanbevelingen (recommendations). Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited.

**Input:**
- `query` (required): Search query in Dutch (e.g., `toestemming cookies`, `kinderen`, `TikTok`)
- `type` (optional): Filter by decision type — `boete`, `aanbeveling`, `besluit`, or `normuitleg`
- `topic` (optional): Filter by topic ID (e.g., `kinderen`, `cookies`, `profilering`)
- `limit` (optional): Maximum number of results (default: 20, max: 100)

---

### `nl_dp_get_decision`

Get a specific AP decision by its reference number.

**Input:**
- `reference` (required): AP decision reference (e.g., `AP-2021-001`, `AP-2023-015`)

---

### `nl_dp_search_guidelines`

Search AP guidance documents including handleidingen (handbooks), normuitleg (norm explanations), richtsnoeren (guidelines), and beleidsregels (policy rules).

**Input:**
- `query` (required): Search query in Dutch (e.g., `beveiliging persoonsgegevens`, `datalekken`)
- `type` (optional): Filter by guidance type — `handleiding`, `normuitleg`, `richtsnoer`, or `beleidsregel`
- `topic` (optional): Filter by topic ID
- `limit` (optional): Maximum number of results (default: 20, max: 100)

---

### `nl_dp_get_guideline`

Get a specific AP guidance document by its database ID (obtained from `nl_dp_search_guidelines` results).

**Input:**
- `id` (required): Guideline database ID (integer)

---

### `nl_dp_list_topics`

List all data protection topics covered by the corpus with Dutch and English names. Use the returned topic IDs to filter `nl_dp_search_decisions` and `nl_dp_search_guidelines`.

**Input:** None

---

### `nl_dp_about`

Return metadata about this MCP server including version, data source, corpus coverage summary, and complete tool list.

**Input:** None

---

### `nl_dp_list_sources`

List the primary data sources used by this server, including source URLs, organization names, data types covered, and geographic scope.

**Input:** None

---

### `nl_dp_check_data_freshness`

Query the local database for record counts and the latest decision/guideline dates. Useful for determining how up-to-date the corpus is.

**Input:** None

**Output fields:**
- `decisions.count`: Total number of decisions in the database
- `decisions.latest_date`: ISO date of the most recent decision
- `guidelines.count`: Total number of guidelines in the database
- `guidelines.latest_date`: ISO date of the most recent guideline
- `checked_at`: ISO timestamp of when the check was performed

## Common Response Fields

All tool responses include a top-level `_meta` object:

```json
{
  "_meta": {
    "disclaimer": "...",
    "copyright": "...",
    "source_url": "https://www.autoriteitpersoonsgegevens.nl/",
    "data_age": "YYYY-MM-DD"
  }
}
```

Detail tools (`nl_dp_get_decision`, `nl_dp_get_guideline`) also include a `_citation` object for the deterministic citation pipeline.
