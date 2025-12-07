# Feature: Interactive Plan Mode

## Overview

A queue-based work process that enables users to flesh out features through an interactive Q&A session with Claude. The mode uses a wizard-style interface to gather requirements, creates a structured implementation plan, and can spawn a new session to execute the plan.

## Requirements

### Entry Point
- "Plan" button in AppHeader, positioned next to the Thinking toggle (right side)
- Text-only button style (no icon)
- Clicking opens a new SDK session in Plan Mode

### Question Wizard Component
- Replaces the prompt input area at the bottom of the chat
- Displays one question at a time with navigation between questions
- Horizontal chips/pills at top showing question headers (navigation + progress)
- Each question has a one-word title/header (max 12 chars) displayed in navigation
- Text input always available alongside options (implicit "Other" option)
- Can submit anytime - unanswered questions are left open
- Supports single-choice, multiple-choice, and text input question types

### Visual Indicators
- Sidebar badge: "Planning" text with distinct color on plan mode sessions
- Persistent banner: "Plan Mode" label at top of chat area

### Session Behavior
- Plan mode sessions remain as plan mode (no switching to regular mode)
- Full tool access during planning (Claude can explore codebase)
- Sessions persist like normal SDK sessions (can resume if closed)
- User can ask Claude to modify plan sections before implementation

### Plan File
- Saved to `plans/{feature-name}.md` in the selected repository
- Created early and progressively updated as questions are answered
- Uses structured format with sections
- Revealed at the end (no live preview during planning)

### Implementation Handoff
- "Start Implementation" spawns a new SDK session
- Implementation session receives structured prompt pointing to plan file
- Implementation session can update plan file to mark completed items

## Decisions Made

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Entry point location | AppHeader next to Thinking | Consistent with other mode toggles, easily accessible |
| Question display | Wizard replacing prompt input | Clean UX, focuses user attention, no modal interruption |
| Navigation style | Horizontal chips with headers | Shows progress and allows quick jumping between questions |
| Questions per round | Up to 5 | Balances depth with avoiding overwhelm |
| Plan file location | `plans/` in repo | Keeps plans with the codebase, version controlled |
| Plan visibility | Hidden until complete | Avoids distraction, reveals polished result |
| Implementation spawn | New session | Clean separation, dedicated context for implementation |
| Session persistence | Same as SDK sessions | Consistent behavior, can resume planning later |
| Tool access in plan mode | Full access | Claude can explore codebase while planning |

## Alternatives Considered

| Alternative | Why Not Chosen |
|-------------|----------------|
| Modal for questions | Interrupts flow, less integrated feel |
| Plan preview during planning | Adds complexity, may distract from Q&A flow |
| Toggle to switch modes | Complicates session state, cleaner to keep modes separate |
| Spawn multiple implementation sessions | Over-engineered, single session with full plan is simpler |
| Questions as chat messages | Loses structured input benefits, harder to navigate back |

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Plan Mode Session State
- [ ] Add `isPlanMode: boolean` field to SDK session type in `sdkSessions.ts`
- [ ] Add `planFilePath?: string` field to track associated plan file
- [ ] Add `planFeatureName?: string` field for the feature being planned
- [ ] Update session persistence to include plan mode fields

#### 1.2 Plan Mode System Prompt
- [ ] Create `src/lib/prompts/planMode.ts` with system prompt content
- [ ] Instructions for using `ask_planning_questions` tool
- [ ] Instructions for progressive plan updates via Write tool
- [ ] Instructions for calling `complete_planning` when done
- [ ] Plan file structure template

#### 1.3 Sidecar Tool Definitions
- [ ] Add `ask_planning_questions` tool definition in sidecar
- [ ] Add `complete_planning` tool definition in sidecar
- [ ] Handle tool calls and emit appropriate events to frontend

### Phase 2: UI Components

#### 2.1 Plan Mode Button
- [ ] Add "Plan" button to `AppHeader.svelte`
- [ ] Position next to Thinking toggle on right side
- [ ] Style as text-only button
- [ ] On click: create new plan mode session

#### 2.2 Question Wizard Component
- [ ] Create `src/lib/components/sdk/PlanningWizard.svelte`
- [ ] Horizontal navigation chips showing question headers
- [ ] Current question display with options
- [ ] Single-choice rendering (radio-style buttons)
- [ ] Multiple-choice rendering (checkbox-style buttons)
- [ ] Text input field (always visible)
- [ ] Back/Next navigation between questions
- [ ] Submit button to send answers

#### 2.3 Visual Indicators
- [ ] Add "Planning" badge to `SessionList.svelte` for plan mode sessions
- [ ] Create `PlanModeBanner.svelte` component
- [ ] Display banner at top of chat in plan mode sessions

#### 2.4 Completion UI
- [ ] Handle `complete_planning` tool result
- [ ] Show "Planning Complete" state with plan summary
- [ ] Display "Start Implementation" button
- [ ] Show plan file path

### Phase 3: Event Handling & Integration

#### 3.1 Sidecar Events
- [ ] Add `sdk-planning-questions-${id}` event for question batches
- [ ] Add `sdk-planning-complete-${id}` event for completion
- [ ] Handle events in `sdkSessions.ts` store

#### 3.2 Answer Submission
- [ ] Collect answers from wizard component
- [ ] Format answers for Claude (as tool result or user message)
- [ ] Send back to sidecar for continued conversation

#### 3.3 Implementation Session Spawning
- [ ] Create new SDK session with implementation prompt
- [ ] Include plan file path in prompt
- [ ] Include instructions to mark completed items

### Phase 4: Welcome Message & Polish

#### 4.1 Welcome Flow
- [ ] Display welcome message when plan mode session created
- [ ] Explain how plan mode works
- [ ] Wait for user to describe feature to plan

#### 4.2 Session Naming
- [ ] Auto-name plan sessions based on feature (e.g., "Planning: Auth Feature")
- [ ] Update name when `complete_planning` is called

#### 4.3 Edge Cases
- [ ] Handle session close/resume during planning
- [ ] Handle empty/partial answer submission
- [ ] Handle user requesting plan modifications post-completion

## Open Questions

1. Should there be a keyboard shortcut for the Plan button?
2. Should plan mode sessions have a different accent color in the UI?
3. Should we add a "Cancel Planning" action to abandon without saving?
4. Should completed plans be listed somewhere for reference?

## Technical Notes

### Tool Schemas

**ask_planning_questions**
```json
{
  "name": "ask_planning_questions",
  "parameters": {
    "type": "object",
    "required": ["questions"],
    "properties": {
      "questions": {
        "type": "array",
        "minItems": 1,
        "maxItems": 5,
        "items": {
          "type": "object",
          "required": ["question", "header", "options", "multiSelect"],
          "properties": {
            "question": { "type": "string" },
            "header": { "type": "string", "maxLength": 12 },
            "options": {
              "type": "array",
              "minItems": 2,
              "maxItems": 4,
              "items": {
                "type": "object",
                "required": ["label", "description"],
                "properties": {
                  "label": { "type": "string" },
                  "description": { "type": "string" }
                }
              }
            },
            "multiSelect": { "type": "boolean" }
          }
        }
      }
    }
  }
}
```

**complete_planning**
```json
{
  "name": "complete_planning",
  "parameters": {
    "type": "object",
    "required": ["plan_path", "feature_name", "summary"],
    "properties": {
      "plan_path": { "type": "string" },
      "feature_name": { "type": "string" },
      "summary": { "type": "string" }
    }
  }
}
```

### Plan File Template

```markdown
# Feature: [Name]

## Overview
[Summary of what we're building]

## Requirements
- [Captured from Q&A]

## Decisions Made
| Decision | Choice | Reasoning |
|----------|--------|-----------|

## Alternatives Considered
[What we decided against and why]

## Implementation Plan
### Phase 1: ...
### Phase 2: ...

## Open Questions
[Anything still unclear]
```

### Files to Create/Modify

**New Files:**
- `src/lib/components/sdk/PlanningWizard.svelte`
- `src/lib/components/sdk/PlanModeBanner.svelte`
- `src/lib/prompts/planMode.ts`

**Modified Files:**
- `src/lib/components/AppHeader.svelte` - Add Plan button
- `src/lib/stores/sdkSessions.ts` - Plan mode state fields
- `src/lib/stores/sessionPersistence.ts` - Persist plan mode fields
- `src/lib/components/SessionList.svelte` - Planning badge
- `src/lib/components/sdk/SdkPromptInput.svelte` - Integrate wizard
- `src-tauri/sidecar/src/index.ts` - Tool definitions and handlers
