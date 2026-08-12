# The Post-PR Software Factory: A North Star Manifesto

The current trajectory of AI-assisted software engineering has a fatal flaw. The industry is scaling code generation to infinite volumes while keeping human verification capacity fixed. OpenGantry is built for a different future.

## The Bottleneck: The "Outer-Loop" Trap

Right now, the industry treats AI like a junior developer. Agents write code, submit Pull Requests, and rely on human engineers or probabilistic AI reviewers to catch their mistakes.

This creates an unsustainable, leaking loop:

* **Human Review Fatigue:** When autonomous agents generate thousands of lines of code per minute, humans physically cannot review the pull requests fast enough to guarantee architectural safety.
* **Probabilistic Failure:** Using a Large Language Model to review an LLM's code replaces one hallucination risk with another. Cloud-based AI reviewers might catch typos or logic errors, but they cannot definitively prove that microservice boundaries remain intact.

## The Paradigm Shift: From Reviewer to Referee

To safely scale autonomous software development, governance must shift from the **Outer Loop** (post-commit pull requests) to the **Inner Loop** (pre-commit local generation).

Mechanically, autonomous execution is a directed graph — Visionary intent fans out to parallel Executor nodes, with OpenGantry as a gating referee on each edge. Inner and Outer Loop name the DevEx *where* work runs, not a sequential agent cycle.

We are replacing the polite, probabilistic *AI Reviewer* with a rigid, deterministic *Architectural Referee*.

1. **Probabilistic reviewers leave comments.** They ask the agent to kindly fix a structural mistake in a pull request.
2. **Deterministic referees throw Exit 1.** They use Abstract Syntax Tree (AST) parsing to mathematically prove a rule was broken. They drop a physical cage over the agent locally, blocking the commit until the codebase complies.

## The Two-Role Software Factory

When you remove the need for humans to manually read AI-generated code, the engineering organizational chart collapses into its two purest functions: **Intent** and **Physics**.

### 1. The Visionary (The "What")

This role owns the business intent. They do not write code. Their interface is the product roadmap.

* **The Job:** Define new business capabilities, set acceptance criteria, and feed plain-text feature requests into the top of the autonomous funnel.

### 2. The Architect (The "How")

This role owns the physical laws of the repository.

* **The Job:** Define the deterministic constraints. They write the Abstract Syntax Tree rules, strict JSON schemas, and allowed module imports. They do not build features; they build the OpenGantry cages that force agents to build features correctly.

## The Crucible: Autonomous Assembly

In this end-state, the software lifecycle runs continuously without human bottlenecks:

1. **The Trigger:** The Visionary drops a business requirement into the event bus.
2. **The Execution:** Local agent swarms spin up to generate the code.
3. **The Cage:** Before the agent can finish, the OpenGantry referee scans the codebase. If the agent hallucinated a global state mutation or bypassed the event bus, the scanner instantly rejects it. The human never sees this failure. The error bounces straight back to the agent in the dark.
4. **The Output:** The agent iterates until the AST math returns Exit 0.

By the time code reaches a staging environment, it has already been mathematically proven to obey the Architect's laws. You no longer build software. You build the deterministic machine that builds the software.
