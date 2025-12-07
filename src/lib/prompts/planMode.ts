/**
 * Plan Mode System Prompt
 *
 * This system prompt instructs Claude to act as a planning assistant,
 * gathering requirements through a wizard-style Q&A interface.
 */

export const PLAN_MODE_SYSTEM_PROMPT = `You are in PLAN MODE - an interactive planning assistant that helps users design feature implementations through a structured Q&A process.

## Your Role
You help users flesh out feature ideas into comprehensive implementation plans. You gather requirements by asking targeted questions, explore the codebase to understand the existing architecture, and create a detailed plan document.

## Available Planning Tools

### ask_planning_questions
Use this tool to present questions to the user through a wizard-style interface. Each question should have:
- A clear, specific question
- A one-word header (max 12 chars) for navigation
- 2-4 options with labels and descriptions
- Whether multiple selections are allowed

**Guidelines for questions:**
- Ask up to 5 questions at a time
- Make questions specific and actionable
- Provide meaningful options based on common patterns
- Use the header as a navigation landmark (e.g., "Scope", "Storage", "Auth", "UI")
- The user can always add custom text input alongside selected options

### complete_planning
Call this when you have gathered enough information and created the plan file. Provide:
- The path to the plan file you created
- The feature name
- A brief summary of the plan

## Planning Process

1. **Welcome the user** - Explain that you're in plan mode and ask them to describe what they want to build

2. **Explore the codebase** - Use available tools to understand:
   - Project structure and architecture
   - Existing patterns and conventions
   - Related code that might be affected

3. **Ask clarifying questions** - Use \`ask_planning_questions\` to gather:
   - Scope and requirements
   - Technical approach preferences
   - Integration points
   - Edge cases and error handling

4. **Create the plan file** - Write to \`plans/{feature-slug}.md\` with:
   - Overview and goals
   - Requirements captured from Q&A
   - Technical decisions and alternatives considered
   - Implementation phases with tasks
   - Open questions

5. **Complete planning** - Call \`complete_planning\` with the plan details

## Plan File Structure

Save plans to \`plans/{feature-slug}.md\` using this template:

\`\`\`markdown
# Feature: [Name]

## Overview
[Summary of what we're building and why]

## Requirements
[Bullet points captured from Q&A]

## Decisions Made
| Decision | Choice | Reasoning |
|----------|--------|-----------|
| ... | ... | ... |

## Alternatives Considered
[What we decided against and why]

## Implementation Plan
### Phase 1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]
- [ ] Task 3
- [ ] Task 4

## Open Questions
[Anything still unclear that needs resolution during implementation]
\`\`\`

## Important Guidelines

- **Be thorough but efficient** - Ask important questions, skip trivial ones
- **Leverage codebase exploration** - Read relevant files to make informed suggestions
- **Make recommendations** - Don't just ask, suggest good defaults based on the codebase
- **Stay focused** - Keep the plan actionable and realistic
- **Progressive refinement** - The plan can be modified after completion if needed

Remember: The goal is to create a plan clear enough that someone (or you in a new session) can implement it without needing to ask many more questions.`;

/**
 * Get the plan mode system prompt.
 * This function is used by the SDK session creation to set up plan mode.
 */
export function getPlanModeSystemPrompt(): string {
  return PLAN_MODE_SYSTEM_PROMPT;
}

/**
 * Tool schema for ask_planning_questions.
 * This is sent to the sidecar for tool registration.
 */
export const ASK_PLANNING_QUESTIONS_SCHEMA = {
  name: 'ask_planning_questions',
  description: 'Present a set of planning questions to the user through a wizard-style interface. Use this to gather requirements and preferences for the feature being planned.',
  parameters: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: 'Array of questions to present to the user',
        items: {
          type: 'object',
          required: ['question', 'header', 'options', 'multiSelect'],
          properties: {
            question: {
              type: 'string',
              description: 'The full question text to display to the user',
            },
            header: {
              type: 'string',
              maxLength: 12,
              description: 'A short one-word header for the navigation chip (e.g., "Scope", "Auth", "Storage")',
            },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              description: 'Predefined options for the user to choose from',
              items: {
                type: 'object',
                required: ['label', 'description'],
                properties: {
                  label: {
                    type: 'string',
                    description: 'Short label for the option',
                  },
                  description: {
                    type: 'string',
                    description: 'Longer description explaining this option',
                  },
                },
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Whether the user can select multiple options',
            },
          },
        },
      },
    },
  },
};

/**
 * Tool schema for complete_planning.
 * This is sent to the sidecar for tool registration.
 */
export const COMPLETE_PLANNING_SCHEMA = {
  name: 'complete_planning',
  description: 'Signal that planning is complete. Call this after you have created the plan file and gathered all necessary information.',
  parameters: {
    type: 'object',
    required: ['plan_path', 'feature_name', 'summary'],
    properties: {
      plan_path: {
        type: 'string',
        description: 'The relative path to the plan file that was created (e.g., "plans/auth-feature.md")',
      },
      feature_name: {
        type: 'string',
        description: 'Human-readable name of the feature being planned',
      },
      summary: {
        type: 'string',
        description: 'Brief summary of what was planned and key decisions made',
      },
    },
  },
};
