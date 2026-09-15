# Reading preference examples

These examples describe supported preference scopes, not a shared profile applied to all users. The application loads the reading Skill and the current device policy.

| ID | Preference | Scope and constraints |
| --- | --- | --- |
| P01 | Continuous translation without extra headings | Preserve mathematical meaning; do not flatten explanations or override explicit formatting settings. |
| P02 | Structured long explanations | Short answers need not use a rigid template. |
| P03 | Contextual terminology and analogies | Distinguish source claims from supplementary interpretation. |
| P04 | Current-paper and reference evidence first | Bibliography metadata alone is not inspected full-text evidence. |
| P05 | Low-latency translation and contextual caching | Do not sacrifice accuracy or initiate speculative paid calls. |
| P06 | Task-specific thinking configuration | Preserve explicit saved settings instead of imposing a global toggle. |
| P07 | User-defined library folders | Application collections do not grant system filesystem permissions. |

## Conflict and persistence

The current request and explicit settings take precedence. Persist a preference only when lasting intent is explicit or confirmed; otherwise apply it to the current task. Later preferences supersede earlier ones only within the same scope. Preserve versions for rollback.

Questions, source quotations, and error messages are not preference updates. Ambiguous feedback requires context and must not silently become a permanent rule.
