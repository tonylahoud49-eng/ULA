---
name: ULA Claims Hub
description: A controlled release-docket interface for evidence-led claims reporting.
colors:
  ula-teal: "hsl(169 63% 33%)"
  issue-paper: "hsl(140 10% 96%)"
  sheet-white: "hsl(0 0% 100%)"
  graphite: "hsl(165 25% 10%)"
  quiet-paper: "hsl(145 9% 93%)"
  quiet-graphite: "hsl(158 8% 38%)"
  rule: "hsl(150 10% 76%)"
  sidebar-ink: "hsl(166 29% 10%)"
  sidebar-paper: "hsl(150 15% 92%)"
  warning-amber: "hsl(35 58% 49%)"
  alert-red: "hsl(4 45% 49%)"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.35rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.12em"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ula-teal}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  docket-surface:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "40px"
  status-mark:
    backgroundColor: "{colors.issue-paper}"
    textColor: "{colors.ula-teal}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
---

# Design System: ULA Claims Hub

## Overview

**Creative North Star: "The Release Docket"**

ULA Claims Hub uses the visual language of a controlled professional issue sheet: cool paper, graphite rules, restrained ULA teal, dense registers, and explicit release states. The system feels precise and operational rather than promotional. It gives evidence, responsibility, readiness, and approval equal visual weight so professional judgment remains visible throughout the workflow.

Density is deliberate but readable. Large condensed headings establish hierarchy; compact labels, tabular numbers, and ruled surfaces carry claim detail without turning the application into a generic card dashboard. Route-specific compositions may vary, but every working surface should reveal its current state and next professional gate.

**Key Characteristics:**

- Controlled-document hierarchy with strong reading order.
- Flat issue-sheet surfaces structured by rules and tonal layers.
- ULA teal reserved for primary action, current state, and verified progress.
- Condensed technical headings paired with highly readable body copy.
- Evidence, human review, and approval provenance remain explicit.

## Colors

The palette is a cool working-paper neutral system anchored by one institutional teal; amber and red appear only when status meaning requires them.

### Primary

- **ULA Teal:** Primary actions, selected navigation, focus, verified steps, and controlled-report emphasis.

### Secondary

- **Warning Amber:** Evidence gaps, pending attention, and caution states.
- **Alert Red:** Destructive actions and genuine error states.

### Neutral

- **Issue Paper:** Application canvas and quiet working background.
- **Sheet White:** Forms, registers, report previews, and other active document surfaces.
- **Graphite:** Primary text and structural contrast.
- **Quiet Graphite:** Supporting copy, labels, and secondary values.
- **Rule:** Borders, table dividers, and section boundaries.
- **Sidebar Ink:** Persistent navigation field.

**The Controlled Accent Rule.** ULA teal identifies action or controlled state; it is not decorative fill.

**The Status Truth Rule.** Amber and red are semantic status colors and never ambient decoration.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow and sans-serif fallbacks)  
**Body Font:** Source Sans 3 (with ui-sans-serif and system-ui fallbacks)

**Character:** The narrow display face evokes technical registers and issued reports without imitating stamped or distressed lettering. Source Sans 3 keeps dense claim data calm and legible.

### Hierarchy

- **Display** (600, responsive 2rem–2.35rem, 1): Page purpose and claim identity.
- **Title** (600, 1.5rem, 1): Workspace headers and major register sections.
- **Body** (400–600, 0.875rem, 1.5): Forms, tables, descriptions, and actions.
- **Label** (600, 0.68rem, 0.12em, uppercase): Field names, metrics, statuses, and document-control metadata.

**The Two-Voice Rule.** Barlow Condensed carries headings; Source Sans 3 carries every operational value and action.

## Layout

Desktop uses a fixed 272px navigation rail and a fluid content canvas capped at 1600px. Content padding steps from 16px on mobile to 24px and 32px on wider screens. The core spatial rhythm is 8px with recurring 16px, 24px, and 32px groupings.

Registers and process rails prefer contiguous divided rows over collections of detached cards. On small screens the rail becomes a drawer, metric strips become vertical, tables provide readable fallbacks, and primary actions expand when useful. Claim identity and the next gate remain above the fold on task-focused routes.

**The Contiguous Record Rule.** Related facts share a ruled surface; do not fragment a single record into decorative tiles.

## Elevation & Depth

Depth is quiet and secondary to borders. Working surfaces use fine graphite rules and small tonal shifts; a low ambient shadow may distinguish a complete sheet from the canvas. Primary buttons use a compact action shadow. There are no bevels, hard offset shadows, glass effects, or simulated physical materials.

### Shadow Vocabulary

- **Sheet Lift** (`0 18px 38px -32px rgb(15 33 29 / 0.72)`): Low ambient separation for complete docket surfaces.
- **Action Lift** (`0 8px 18px -14px rgba(15,33,29,0.9)`): Primary action emphasis only.

**The Paper-First Rule.** Borders establish structure; shadows only separate a complete sheet or primary action from its background.

## Shapes

The form language is disciplined and slightly softened. Controls use 4px corners, primary sheets use 6px corners, and status marks use 2px corners. Full circles are reserved for avatars, progress seals, and approval marks. Thin borders carry tables, fields, tabs, and workflow stages.

## Components

### Buttons

- **Shape:** Compact 4px corners with 40px default height.
- **Primary:** ULA teal with white text and a low action shadow.
- **Hover / Focus:** Subtle tonal shift; a two-pixel teal focus ring remains visible for keyboard users.
- **Outline / Ghost:** White or transparent at rest, with rule-based structure and a quiet teal hover state.

### Status Marks

- **Style:** Compact rectangular marks with uppercase tracked labels, thin semantic borders, and low-tint backgrounds.
- **State:** Color communicates verified, pending, draft, final, caution, or error meaning; shape stays consistent.

### Cards / Containers

- **Corner Style:** Gently curved sheets (6px).
- **Background:** Sheet white on issue paper.
- **Shadow Strategy:** Sheet Lift only when a complete surface needs separation.
- **Border:** One-pixel rule with internal dividers for related records.
- **Internal Padding:** 16px for dense registers; 24px for primary work areas.

### Inputs / Fields

- **Style:** White field, one-pixel input rule, 4px corners, and compact horizontal padding.
- **Focus:** ULA teal border plus a translucent two-pixel focus ring.
- **Error / Disabled:** Semantic error color for invalid state; muted paper and reduced opacity for disabled state.

### Navigation

The desktop rail uses Sidebar Ink with compact icon-and-description links. The current route uses ULA teal; hover uses a quiet ink tonal shift. On mobile the same information moves into a dismissible drawer while the route title remains in a sticky header.

### Release Chain

Five contiguous stages—Evidence, Analysis, Adjustment, Review, Approval—show completed, current, and pending gates. The chain remains a process control, not a decorative stepper: status copy, readiness, and professional responsibility accompany it.

## Do's and Don'ts

### Do:

- **Do** keep evidence, readiness, assigned responsibility, version, and approval state visible near report actions.
- **Do** use contiguous registers, rules, tabular figures, and short operational labels for dense claim information.
- **Do** reserve ULA teal for current state, verified progress, focus, and primary action.
- **Do** preserve keyboard focus, reduced-motion handling, readable contrast, and mobile reflow.

### Don't:

- **Don't** turn claims or report stages into a generic grid of floating KPI cards.
- **Don't** use gradients, glass, distressed type, fake stamps, bevels, or material imitation.
- **Don't** use amber or red without a real workflow or validation meaning.
- **Don't** hide AI provenance or imply that AI can approve, finalize, or replace professional judgment.
