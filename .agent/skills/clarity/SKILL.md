---
name: clarity
description: Apply whenever creating, revising, or reviewing human-readable
  content, including PR and issue bodies, code-review findings, reports,
  documentation, summaries, descriptions, status updates, and technical
  explanations. Make content easy to understand without changing its meaning.
  Preserve evidence, uncertainty, constraints, language rules, and exact
  technical identifiers.
---

# Clarity Communication

## Objective

Communicate technical and non-technical information so the intended reader can
understand the conclusion, its basis, its implications, and any required action
without guessing.

Optimize for:

1. Accuracy before fluency.
2. Clarity before sophistication.
3. Evidence before confidence.
4. Completeness of meaning before brevity.
5. Conciseness without omission of material facts.

Plain language must never change the underlying truth.

## When to Apply

Apply these rules whenever authoring or materially revising human-readable
prose, including explanations, PR and issue bodies, review findings, reports,
documentation, summaries, descriptions, and status messages.

Respect the requested artifact, audience, format, tone, and level of detail.
Do not add explanations or sections that the task does not need.

## Rule Precedence

1. Follow applicable user instructions and repository instructions.
2. Preserve the language and structure required by the artifact or its template.
3. Apply this skill without overriding higher-priority constraints.
4. Never change technical meaning merely to make wording simpler.

For repository work, inspect the relevant AGENTS.md files and existing templates
before writing. Do not create a competing language policy or duplicate canonical
documentation.

## Writing Procedure

### 1. Establish Context

Determine:

- What the reader needs to understand or decide.
- Who the intended reader is and what they are likely to know.
- What language and format the artifact requires.
- Which facts, constraints, and evidence are available.

Do not assume the reader already understands an unexplained technical term.
Do not assume the reader lacks technical ability either.

### 2. Establish the Facts

Use the relevant source of truth:

- Code, configuration, and diffs for implementation behavior.
- Actual test output and command results for verification claims.
- Logs and observed behavior for incident analysis.
- Canonical documents and contracts for documented decisions.
- Reliable sources for externally dependent facts.

Distinguish explicitly between:

- Verified fact.
- Inference supported by evidence.
- Hypothesis that remains unverified.
- Unknown or unavailable information.

Never invent evidence, test results, root causes, metrics, sources, or certainty.

A plausible explanation is not a confirmed explanation. If evidence is missing,
state the limitation and avoid presenting an assumption as fact.

### 3. Explain Clearly

- Put the main conclusion or answer first.
- Use familiar, precise words where possible.
- Keep each sentence focused on one main idea.
- Explain necessary technical terms when the intended reader may not know them.
- Explain cause, conditions, mechanism, and impact when they matter.
- Use active, direct wording where natural in the target language.
- Prefer concrete examples when they improve understanding.
- Use analogies only when they preserve the important properties of the subject.
- State an analogy's limitations when they could affect understanding.
- Keep paragraphs and lists focused; do not force a generic structure onto
  every artifact.

Simple language does not mean childish language. Do not replace precise
technical explanations with vague metaphors.

### 4. Preserve Meaning

Never simplify away:

- Preconditions, postconditions, exceptions, or failure modes.
- Negation, uncertainty, causal relationships, or temporal ordering.
- Security boundaries, consistency guarantees, or compatibility constraints.
- Quantitative limits, units, ranges, and material qualifications.
- Relevant scope, assumptions, or known limitations.

Preserve identifiers, file paths, commands, API names, configuration keys,
error codes, quoted output, and other exact technical values.

Do not translate a technical term when translation would reduce precision.
When a term needs explanation, preserve the term and explain its meaning.

### 5. Adapt to the Artifact

Use the existing format and repository conventions.

For PR and issue bodies:

- Explain why the change is needed and what changed.
- Describe material behavior or contract changes.
- Report only verification that actually occurred.
- State relevant limitations, risks, or work not completed.
- Preserve required template headings and conventions.

For code-review findings:

- Identify the problematic behavior and relevant evidence.
- Explain the conditions under which it occurs.
- Describe the actual or potential impact.
- Distinguish confirmed defects from hypothetical risks.
- Give a concrete remediation direction when supported.
- Follow the repository's severity scheme; never invent one.

For reports and incident updates:

- State the current status and scope.
- Separate observed symptoms from confirmed root cause.
- Distinguish completed actions from planned actions.
- Describe remaining risks and unresolved questions.
- Include timelines, measurements, and references when relevant.

For documentation, descriptions, and technical explanations:

- State purpose, behavior, boundaries, and relevant assumptions.
- Use examples only when they add understanding.
- Respect the canonical source of truth and avoid duplicating existing material.
- Explain the mechanism instead of merely repeating a conclusion.

### 6. Respect the Language

Apply the language rules of the repository and artifact.

Write naturally in the required language. Adapt grammar, sentence structure,
terminology, and examples to that language rather than translating English
writing rules mechanically.

Do not impose English-specific readability metrics, fixed sentence-length
limits, or vocabulary restrictions on every language.

Do not switch languages unnecessarily. Preserve established technical terms
and exact identifiers according to the applicable repository conventions.

### 7. Perform an Adversarial Review

Before delivering the content, check:

- Can the intended reader identify the main conclusion immediately?
- Does every material factual claim have sufficient evidence?
- Have facts, inferences, hypotheses, and unknowns been distinguished?
- Could a sentence be interpreted differently in a way that changes a decision?
- Are any conditions, exceptions, limitations, or negative cases missing?
- Does the wording imply causation or certainty that the evidence does not support?
- Are technical terms and identifiers accurate and consistent?
- Does the content obey the language rules and artifact template?
- Can unnecessary wording be removed without losing meaning?

Revise any statement that is misleading, unsupported, ambiguous, or needlessly
complex. If a material uncertainty cannot be resolved, disclose it explicitly.

## Completion Criteria

Deliver only when:

- The conclusion and intended action are understandable.
- Material claims are supported or explicitly qualified.
- Simplification has not changed the technical meaning.
- Relevant constraints and uncertainty remain visible.
- The required language, format, and level of detail are respected.
- The content is concise without omitting information needed for a correct decision.
