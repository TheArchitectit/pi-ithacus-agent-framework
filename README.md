# pi-ithacus-agent-framework

Brings popular agentic coding styles into [pi](https://github.com/earendil-works/pi). You get structured agent workflows, guardrails, task tracking, and a setup flow that makes spawning sub-agents and agents easy to navigate.

## What it does

- **Agent workflows** — structured sprint tasks, review cycles, and multi-agent routing without the boilerplate
- **Guardrails** — prevention rules and pattern matching that keep agents from going off the rails
- **Sub-agent setup** — pairs with [pi-setup](https://github.com/TheArchitectit/pi-setup) to give you a clean React dashboard for configuring agents and sub-agents — no JSON editing
- **LSP integration** — your agents see real diagnostics, definitions, and references, not just raw text
- **Cost tracking** — token usage and spend across providers, per-agent
- **Checkpoint system** — session state persists and recovers cleanly across restarts
- **Compact context** — vector-backed compression for long sessions, so your agents don't lose the thread
- **Model profiles** — multi-provider routing with per-agent model assignment

## How it fits in

Install this alongside [pi-mega-compact](https://github.com/TheArchitectit/pi-mega-compact) for context compression and pi-setup for the React config dashboard. Together they give you a full agentic coding environment that runs locally with any OpenAI-compatible provider — local or cloud.

## Install

```bash
pi install npm:pi-ithacus-agent-framework
```

From source:

```bash
git clone https://github.com/TheArchitectit/pi-ithacus-agent-framework.git \
  ~/.pi/agent/extensions/pi-ithacus-agent-framework
cd ~/.pi/agent/extensions/pi-ithacus-agent-framework
npm install && npm run build
```

## License

MIT

## ☕ Support

If this project helped you, consider buying me a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-TheArchitectit-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/TheArchitectit)
