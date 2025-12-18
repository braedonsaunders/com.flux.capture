# Proposal: Unmatched Extracted Data Access

**Feature**: Expose unmatched document extraction data to users with intuitive field assignment
**Status**: Draft Proposal
**Date**: 2025-12-18

---

## Problem Statement

When documents are processed through the Flux Capture extraction engine, the AI/OCR extracts **many more data points** than are automatically matched to form fields. Currently:

- The `FieldMatcher.js` only maps ~12 known fields (invoice number, dates, amounts, vendor, etc.)
- All other extracted label/value pairs are stored in `extractedData._allExtractedFields` but remain **invisible to users**
- This "hidden treasure" includes: payment terms, bank details, account codes, custom reference numbers, contact info, notes, and more
- Users have no way to see what was extracted, and no easy way to use that data

**Result**: Valuable extracted data goes unused, and users must manually type information that the system already captured.

---

## Proposed Solution: "Extraction Pool" System

A multi-layered UX approach that gives users **instant visibility** into all extracted data and **frictionless assignment** to any form field.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REVIEW VIEW LAYOUT                                 │
├─────────────────────┬──────────────────┬────────────────────────────────────┤
│                     │                  │                                     │
│   Document Preview  │  Panel Resizer   │       Extraction Form               │
│                     │                  │                                     │
│   [PDF/Image View]  │       ║          │  ┌─────────────────────────────┐   │
│                     │       ║          │  │ EXTRACTION POOL (Collapsible)│   │
│                     │       ║          │  │ ┌─────┐ ┌─────┐ ┌─────┐     │   │
│   Toggle: Show      │       ║          │  │ │chip1│ │chip2│ │chip3│ ... │   │
│   Extraction        │       ║          │  │ └─────┘ └─────┘ └─────┘     │   │
│   Regions           │       ║          │  │ [search] [filter by type]   │   │
│                     │       ║          │  └─────────────────────────────┘   │
│                     │       ║          │                                     │
│                     │       ║          │  [Form Fields with Drop Zones]     │
│                     │       ║          │                                     │
└─────────────────────┴──────────────────┴────────────────────────────────────┘
```

---

## Component 1: Extraction Pool Panel

A **collapsible panel** at the top of the extraction form showing all unmatched data.

### 1.1 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▼ EXTRACTION POOL                                           12 items │ ⚙️  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 🔍 Search extractions...                    [All ▼] [Amounts] [Dates] [Text]│
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │ Payment Terms  │  │ Bank Account   │  │ Reference #    │                 │
│  │ ─────────────  │  │ ─────────────  │  │ ─────────────  │  ...            │
│  │ Net 30         │  │ 1234-5678-90   │  │ REF-2024-001   │                 │
│  │         ⋮ 87%  │  │         ⋮ 92%  │  │         ⋮ 78%  │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │ Contact Name   │  │ Email          │  │ Notes          │                 │
│  │ ─────────────  │  │ ─────────────  │  │ ─────────────  │  ...            │
│  │ John Smith     │  │ ap@vendor.com  │  │ Rush delivery  │                 │
│  │         ⋮ 65%  │  │         ⋮ 91%  │  │         ⋮ 72%  │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Card Properties

Each extraction card displays:
- **Label**: The detected field name from the document (e.g., "Payment Terms")
- **Value**: The extracted value (truncated with tooltip for long values)
- **Confidence Badge**: Visual indicator (green/amber/red) with percentage
- **Context Menu** (⋮): Quick actions - Copy, Find in Document, Dismiss

### 1.3 Interaction Modes

**Mode A: Drag & Drop**
- User drags a card from the pool
- Form fields glow/highlight as valid drop targets
- Drop onto a field to assign the value
- Card moves to "Applied" section (or fades with checkmark)

**Mode B: Click to Select → Click to Assign**
- Click a card to select it (card elevates, glows)
- Click any form field to assign the value
- Press Escape to deselect

**Mode C: Card Quick-Assign Menu**
- Click the ⋮ menu on a card
- Select "Assign to..." → shows searchable field list
- Select target field from dropdown

### 1.4 Panel States

| State | Appearance |
|-------|------------|
| Expanded (default) | Full panel with all cards visible |
| Collapsed | Single line: "EXTRACTION POOL • 12 unassigned items" |
| Empty | Hidden or subtle message: "All extractions matched!" |
| Filtered | Shows count: "Showing 4 of 12 items" |

---

## Component 2: Smart Field Suggestions

Inline suggestions that appear **in empty form fields**.

### 2.1 Ghost Text Suggestion

```
┌────────────────────────────────────────┐
│ Memo                                   │
│ ┌────────────────────────────────────┐ │
│ │ Rush delivery - handle with care   │ │  ← Ghost text (faded)
│ │                         [Tab ↹ ✓]  │ │
│ └────────────────────────────────────┘ │
│ 💡 Suggested from: "Notes" (72%)       │
└────────────────────────────────────────┘
```

**Behavior**:
- Ghost text shows the suggested value in a faded style
- Press **Tab** or click checkmark to accept
- Start typing to replace/ignore the suggestion
- Suggestion source shown below the field

### 2.2 Multiple Suggestions Dropdown

When multiple unmatched values could fit a field:

```
┌────────────────────────────────────────┐
│ Reference                              │
│ ┌────────────────────────────────────┐ │
│ │                               [▼]  │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ 💡 REF-2024-001       from: Ref #  │ │
│ │    PO-98765           from: PO No  │ │
│ │    INV-12345          from: Inv #  │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

---

## Component 3: Keyboard-First Quick Assign

For power users who want maximum speed.

### 3.1 Quick Assign Palette (Cmd/Ctrl + Shift + V)

When focused on any form field, user can invoke the palette:

```
┌─────────────────────────────────────────┐
│  Assign to: Memo                        │
│  ───────────────────────────────────────│
│  🔍 Filter extractions...               │
│                                         │
│  ▸ Rush delivery - handle w...   72% 💡 │  ← Best match highlighted
│    Net 30                        87%    │
│    John Smith                    65%    │
│    ap@vendor.com                 91%    │
│    Bank: 1234-5678-90            92%    │
│                                         │
│  ↑↓ Navigate  ↵ Select  Esc Cancel     │
└─────────────────────────────────────────┘
```

**Behavior**:
- Best semantic match is pre-selected
- Type to filter the list
- Arrow keys to navigate
- Enter to assign
- Escape to cancel

### 3.2 Tab-Cycle Through Suggestions

- When in a field with a suggestion, Tab accepts and moves to next field
- Shift+Tab goes back
- Creates a flow: review suggestion → Tab → review suggestion → Tab → done

---

## Component 4: Document Annotation Mode

Visual linking between document and form fields.

### 4.1 Toggle "Show Extractions" on Document Preview

When enabled:
- All extracted regions are highlighted on the document
- **Matched fields**: Green highlight with field name tooltip
- **Unmatched fields**: Amber/orange highlight

```
┌─────────────────────────────────────────┐
│ [Document Preview]                      │
│                                         │
│  ┌──────────────────────┐               │
│  │ INVOICE              │               │
│  │ ══════════════════   │               │
│  │                      │               │
│  │ Invoice #: ▓▓▓▓▓▓▓▓  │  ← Green (matched to tranid)
│  │ Date: ▓▓▓▓▓▓▓▓▓▓▓▓▓  │  ← Green (matched to trandate)
│  │ Payment: ░░░░░░░░░░  │  ← Orange (unmatched!)
│  │                      │               │
│  │ Bank: ░░░░░░░░░░░░░  │  ← Orange (unmatched!)
│  │                      │               │
│  └──────────────────────┘               │
│                                         │
│  [🔍 Show Extractions: ON]              │
└─────────────────────────────────────────┘
```

### 4.2 Click-to-Assign from Document

When clicking an **unmatched** (orange) region:
1. Region pulses to confirm selection
2. Small popover appears with the extracted value
3. User selects target field from dropdown
4. Value is assigned, region turns green

```
     ┌─────────────────────────────┐
     │ Payment: Net 30             │
     └────────────┬────────────────┘
                  │
        ┌─────────▼──────────┐
        │ "Net 30"      87%  │
        │ ───────────────────│
        │ Assign to:         │
        │ [Select field...▼] │
        │   ↳ Memo           │
        │   ↳ Terms          │
        │   ↳ Message        │
        └────────────────────┘
```

---

## Component 5: Applied Items Tracking

Show what has been assigned and allow undo.

### 5.1 "Recently Applied" Section

Below the Extraction Pool, show items that were assigned:

```
┌─────────────────────────────────────────────────────────────────┐
│ ✓ RECENTLY APPLIED                                              │
├─────────────────────────────────────────────────────────────────┤
│  Payment Terms → Memo                              [↩ Undo]     │
│  Reference # → tranid                              [↩ Undo]     │
└─────────────────────────────────────────────────────────────────┘
```

**Undo**: Clicking undo clears the field and returns the card to the pool.

---

## Data Model Changes

### 5.1 Frontend State

```javascript
// New state in View.Review.js
this.extractionPoolState = {
    // All unmatched extracted fields
    unmatched: [
        {
            id: 'extract_1',
            label: 'Payment Terms',
            value: 'Net 30',
            confidence: 0.87,
            position: { page: 1, x: 120, y: 340, w: 80, h: 20 },
            category: 'text',  // amounts, dates, text, reference
            dismissed: false
        },
        // ...
    ],

    // Track assignments made from pool
    applied: [
        {
            extractionId: 'extract_1',
            targetFieldId: 'custbody_memo',
            timestamp: Date.now()
        }
    ],

    // UI state
    panelExpanded: true,
    filterCategory: 'all',
    searchQuery: '',
    selectedCardId: null,
    dragActive: false
};
```

### 5.2 Backend: Persist User Assignments

Store user assignments in `custrecord_flux_user_corrections` for learning:

```javascript
{
    // Existing corrections
    corrections: [...],

    // New: Pool assignments (for ML training)
    poolAssignments: [
        {
            extractedLabel: 'Payment Terms',
            extractedValue: 'Net 30',
            assignedToField: 'custbody_memo',
            assignedToLabel: 'Memo',
            timestamp: '2024-01-15T10:30:00Z'
        }
    ]
}
```

This data can be used to improve `FieldMatcher.js` patterns over time.

---

## Implementation Phases

### Phase 1: Core Extraction Pool (MVP)
- [ ] Compute unmatched extractions on document load
- [ ] Render collapsible Extraction Pool panel
- [ ] Implement drag-and-drop to form fields
- [ ] Basic card UI with label, value, confidence
- [ ] "Applied" tracking with undo

### Phase 2: Smart Field Suggestions
- [ ] Ghost text suggestions in empty fields
- [ ] Tab-to-accept behavior
- [ ] Multiple suggestions dropdown
- [ ] Semantic ranking of suggestions per field

### Phase 3: Keyboard Power Features
- [ ] Cmd+Shift+V quick assign palette
- [ ] Arrow key navigation
- [ ] Tab-cycle through suggestions
- [ ] Keyboard shortcuts for pool operations

### Phase 4: Document Annotation Mode
- [ ] Extraction region highlighting on document
- [ ] Click-to-assign from document regions
- [ ] Visual feedback for matched vs unmatched
- [ ] Zoom-to-region on card hover

### Phase 5: Learning & Refinement
- [ ] Persist pool assignments for ML training
- [ ] Auto-suggest improvements based on user patterns
- [ ] Admin analytics: "Most commonly assigned extractions"

---

## Technical Considerations

### Performance
- Lazy render pool cards (virtualize if >50 items)
- Debounce search/filter operations
- Cache position data for document annotations

### Accessibility
- Full keyboard navigation
- ARIA labels for drag-drop
- Screen reader announcements for assignments
- Focus management on panel expand/collapse

### Mobile/Tablet
- Touch-friendly card selection
- Tap-to-select instead of drag
- Swipe gestures for dismiss/assign

---

## CSS/Styling Approach

Extend existing design system with new components:

```css
/* Extraction Pool Panel */
.extraction-pool { }
.extraction-pool.collapsed { }
.extraction-pool-header { }
.extraction-pool-cards { }

/* Extraction Card */
.extraction-card { }
.extraction-card.selected { }
.extraction-card.dragging { }
.extraction-card.applied { }
.extraction-card-label { }
.extraction-card-value { }
.extraction-card-confidence { }

/* Drop Zones on Form Fields */
.form-field.drop-target { }
.form-field.drop-active { }

/* Ghost Suggestions */
.field-ghost-suggestion { }
.field-suggestion-hint { }

/* Quick Assign Palette */
.quick-assign-palette { }
.quick-assign-item { }
.quick-assign-item.selected { }

/* Document Annotations */
.doc-extraction-overlay { }
.doc-extraction-region { }
.doc-extraction-region.matched { }
.doc-extraction-region.unmatched { }
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to complete review (with pool) | -30% reduction |
| Fields manually typed vs auto-assigned | <20% manual |
| User adoption of pool feature | >70% usage |
| Pool assignments per document | Track average |
| Undo rate (indicates bad suggestions) | <5% |

---

## Open Questions

1. **Should dismissed items persist?** If user dismisses a card, should it stay dismissed on reload?

2. **Multi-document learning**: Should patterns learned from one document apply to others from the same vendor?

3. **Confidence threshold**: Should we hide very low-confidence extractions (<30%) or show everything?

4. **Category detection**: How sophisticated should category detection be? (amounts, dates, addresses, references, free text)

5. **Line item support**: Should the pool support assigning extracted values to line item cells, or just header fields?

---

## Mockup Reference

See attached wireframes (to be created):
- `mockup-pool-expanded.png`
- `mockup-drag-drop.png`
- `mockup-ghost-suggestions.png`
- `mockup-quick-palette.png`
- `mockup-document-annotations.png`

---

## Conclusion

The Extraction Pool system transforms hidden extraction data into an **actionable, visual resource** that users can leverage instantly. The multi-modal approach (drag-drop, click-to-assign, keyboard shortcuts, document linking) ensures that users of all skill levels and preferences can efficiently utilize extracted data.

This feature positions Flux Capture as a truly intelligent document processing system where **no extracted data goes to waste**.
