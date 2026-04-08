# Corpus Coverage

This document describes the completeness and scope of the data corpus indexed by the Dutch Data Protection MCP server.

## Data Source

**Autoriteit Persoonsgegevens (AP)** — the Dutch Data Protection Authority  
Website: https://www.autoriteitpersoonsgegevens.nl/  
Language: Dutch (nl)  
Scope: AVG/GDPR enforcement in the Netherlands

## What Is Covered

### Decisions (`decisions` table)

| Type | Dutch Term | Description |
|---|---|---|
| `boete` | Boetes | Administrative fines imposed for GDPR violations |
| `aanbeveling` | Aanbevelingen | Recommendations issued to organisations |
| `besluit` | Besluiten | Formal decisions (non-fine) |
| `normuitleg` | Normuitleg | Norm explanations clarifying GDPR requirements |

**Indexed fields:** reference, title, entity name, summary, full text, date, GDPR articles, fine amount, topics, status

### Guidelines (`guidelines` table)

| Type | Dutch Term | Description |
|---|---|---|
| `handleiding` | Handleidingen | Practical handbooks for GDPR implementation |
| `normuitleg` | Normuitleg | Norm explanations for specific GDPR provisions |
| `richtsnoer` | Richtsnoeren | Formal guidelines aligned with EDPB guidance |
| `beleidsregel` | Beleidsregels | AP policy rules governing its own enforcement priorities |

**Indexed fields:** reference, title, summary, full text, date, topics

### Topics (`topics` table)

Controlled vocabulary of data protection topics:

| ID | Dutch | English |
|---|---|---|
| `kinderen` | Kinderen | Children |
| `cookies` | Cookies | Cookies |
| `profilering` | Profilering | Profiling |
| `beveiliging` | Beveiliging | Security |
| `datalekken` | Datalekken | Data breaches |
| `toestemming` | Toestemming | Consent |
| `cameratoezicht` | Cameratoezicht | Camera surveillance |
| `grondrechten` | Grondrechten | Fundamental rights |
| `doorgifte` | Doorgifte | International transfers |

## What Is Not Covered

- **EDPB guidelines** — European Data Protection Board guidance is not directly indexed (though AP translations/implementations may appear)
- **Court rulings** — Judicial review of AP decisions is not included
- **Parliamentary documents** — Dutch legislative debates on privacy law are out of scope
- **Non-Dutch language documents** — English-language AP publications are not included by default
- **Real-time updates** — The corpus is updated periodically via the scheduled freshness workflow; there may be a lag between AP publication and corpus inclusion

## Freshness

Data freshness can be checked at runtime using the `nl_dp_check_data_freshness` tool or by inspecting `data/coverage.json`.

A scheduled GitHub Actions workflow (`.github/workflows/check-updates.yml`) runs weekly to detect new AP publications and alert maintainers.

## Completeness Assessment

The corpus aims to cover all publicly available AP enforcement decisions and guidance documents. Completeness depends on the AP website structure and the ingest pipeline (`scripts/ingest-ap.ts`). See `data/coverage.json` for structured coverage metadata.
