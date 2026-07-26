# 途中补贴模式开关与输入框聚焦样式 Design QA

## 对照目标

- Source visual truth: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-effect.png`
- Implementation desktop screenshot: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-implementation-desktop.png`
- Implementation mobile screenshots:
  - `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-implementation-mobile.png`
  - `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-implementation-mobile-auto.png`
- Full-view comparison: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-qa-full.png`
- Focused comparison: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/subsidy-toggle-qa-focused-manual.png`
- Input focus source visual truth: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1.png`
- Input focus implementation screenshots:
  - `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1-implementation-874.png`
  - `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1-implementation-390.png`
  - `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1-global-field-874.png`
- Input focus full-view comparison: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1-qa-full.png`
- Input focus focused comparison: `C:/Users/Winloud/.codex/visualizations/2026/07/26/019f9d32-26d3-7433-9d0e-158692543752/input-label-option-1-qa-focused.png`
- Viewports: desktop `1920 x 1080`; annotated window `874 x 695`; mobile `390 x 844`.
- States: default automatic, manual total `¥80.00`, manual edit dialog, focused dialog amount field, focused basic-information field, cancel, and return to automatic.

## Findings

- No actionable P0/P1/P2 mismatch.
- The source board enlarges the summary block for comparison, while the implementation keeps the existing 360px sticky summary column and existing MUI type scale. This is an intentional product constraint rather than design drift.
- The selected input-focus mock and implementation use the same white floating-label mask, 2px primary focus border, and shadow-free notch. The implementation keeps the existing MUI dialog spacing, which is slightly denser than the concept mock but does not change hierarchy or legibility.

## Fidelity Surfaces

- Fonts and typography: kept the project font stack, existing weights, line heights, zero letter spacing, numeric alignment, and hierarchy. Focused outlined labels use weight 700 and remain fully visible at `874 x 695` and `390 x 844`.
- Spacing and layout rhythm: the old chip and standalone adjustment button were removed. The switch stays beside the subsidy label, and the manual edit icon stays beside the amount. Input heights and page density are unchanged; desktop and mobile captures show no overlap or horizontal overflow.
- Colors and visual tokens: automatic uses the existing primary blue; manual uses the existing warning orange; focused outlined inputs use the same primary blue at 2px with an opaque white label surface and no halo shadow. Card, divider, alert, and text tokens are unchanged.
- Image quality and asset fidelity: the UI has no bitmap assets. The switch is the MUI control and the pencil is the existing Material Icons asset; no placeholder or handcrafted icon was introduced.
- Copy and content: `自动计算`, `人工核定`, `最终总额不随行程或日标准变化`, and the amount/day behavior match the approved mock and existing product rules.
- Accessibility and interaction: the switch exposes the current mode through an accessible label and action tooltip, and mode changes take effect immediately without a dialog. The pencil button has an explicit accessible name; its amount-only dialog keeps validation, Cancel, Enter, and Save behavior.

## Open Questions

- None.

## Implementation Checklist

- [x] Replace calculation chip with the automatic/manual switch.
- [x] Hide the edit action in automatic mode.
- [x] Show the edit icon next to the amount only in editable manual mode.
- [x] Switch modes immediately without a dialog while keeping validated dialog submission for manual amount edits.
- [x] Verify desktop and 390px layouts and both mode transitions.
- [x] Verify the full manual-amount floating label at 874px and 390px widths without page-level horizontal overflow.
- [x] Apply the selected shadow-free focus treatment globally to outlined inputs.
- [x] Verify focused dialog and normal form inputs use the same border, label surface, and typography.
- [x] Compare source and implementation at matching 874px full-view and focused crops.

## Patches Made

- Separated mode switching from amount editing: switch clicks now apply automatic/manual mode immediately without opening a dialog, while the pencil opens an amount-only editor.
- Styled the MUI switch with the approved blue/orange state colors and kept the full label area clickable.
- Removed the standalone `调整途中补贴` button and moved manual editing to the amount-side icon.
- Increased the manual amount field's top spacing from 4px to 12px so the floating label stays fully inside the scrollable dialog content; removed the unnecessary horizontal-overflow override from the first fix attempt.
- Replaced the global outlined-input focus halo with a 2px primary border.
- Added an opaque white surface to shrunk outlined labels and primary weight-700 styling while focused.

## Follow-up Polish

- No P3 follow-up is required for this scope.

final result: passed
