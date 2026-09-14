# Project owner's reading preferences

Status: initial profile specification, derived from explicit feedback in this conversation. The App loads the main reading Skill and the current device policy, not this owner's history. These preferences document the original owner's requirements, not a profile imposed on all visitors.

| ID | Scoped preference | Evidence and interpretation |
| --- | --- | --- |
| P01 | Translation should normally be continuous text, without added paragraph breaks or headings. Preserve mathematical meaning and symbols. | The later request “翻译的时候还是别分段了” supersedes the earlier request to preserve translation paragraph divisions. This does not flatten explanations or summaries. |
| P02 | Long explanations should be structured and easy to follow; short explanations need not use a rigid template. | “对于解释可以适当分段，条理分明”。 |
| P03 | Explain context-relevant technical terms and offer useful extensions or analogies, clearly distinguished from source claims. | Requests for “相关专有名词的解释以及部分联想”。 |
| P04 | Prefer the current paper when answering; referenced papers are important evidence when a question depends on them. | “优先从文献中寻找答案” and “当前文献的参考论文也是重中之重”。 Do not claim a reference was read if only its bibliography entry is available. |
| P05 | Prioritize translation latency and useful contextual caching. | Repeated requests for faster translation and word/term caching. This does not authorize extra paid speculative calls or sacrifice translation accuracy. |
| P06 | Thinking behavior should be configurable by task. | Earlier requests turned translation thinking off and terminology thinking on; later requests asked to expose these as settings. Preserve actual saved choices; do not impose a global thinking toggle. |
| P07 | Organize the library around user-named folders. | Request for flexible folder naming and agent-assisted movement. Physical moves need a real authorized file tool, not only an App collection update. |

## Conflict and persistence rules

An explicit current setting or task instruction takes precedence over this initial profile. Only persist a new preference when the user indicates lasting intent or confirms it; otherwise apply it to the current task only. Later explicit preferences supersede earlier ones only within the same scope. Keep the replaced value in version history for rollback.

Questions, quoted text inside a paper, and an error message are not preference updates. Ambiguous comments such as “还是不对” require task context before classifying a change. Do not translate the owner's preference into a universal factual or methodological rule.
