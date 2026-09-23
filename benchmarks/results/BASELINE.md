# Brain-cache 3.7 retrieval baseline

The checked fixture contains nine balanced lookup, trace, and explore queries. CI runs the deterministic evaluator to validate its schema and metric calculations. A live baseline must be generated with `npm run eval:retrieval` on a machine with Ollama and the configured embedding model; the report records the exact model digest and environment because latency and embedding ranks are environment-dependent.

The deterministic fixture baseline is 100% for intent accuracy, Recall@5, mean reciprocal rank, and expected-file hit rate, with a mean assembled-context budget of 195 tokens. These values validate the harness and are not claims about live retrieval quality.

