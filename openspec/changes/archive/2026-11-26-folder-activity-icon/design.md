## Context

`FoldersTree.tsx` renders each folder's header band as a title line, an optional branch line (General), and an optional facts line. While `folder.isDeleting` or `folder.isPulling` is set, it renders a `.folders-tree__deleting` or `.folders-tree__pulling` span as an extra line and suppresses the facts line. For General, which usually has no facts line, that adds a row and pushes every folder below it down (issue #662). The busy flags come from `useFileExplorerController` and `folderTreeModel`, which stay as they are.

## Goals / Non-Goals

**Goals:**
- The header band's height and the position of every line in the tree are unchanged while git is pulling or deleting.
- The user can still see at a glance that git is at work on a folder, and what it is doing.
- Assistive technology still learns the folder is busy and why.

**Non-Goals:**
- Changing when a folder is considered pulling or deleting.
- The Git panel's Changes pane activity word.
- Showing progress (percentages, phases) of a pull or deletion.

## Decisions

1. **The activity icon takes the folder/branch icon's slot.** The title line already reserves a 15px icon slot before the name. Swapping that glyph for an animated one of the same size changes no width, so neither the name's truncation nor any line moves. Alternatives considered: an extra icon beside the count pill (steals width from the name, and sits where the collapsed-folder attention indicator goes); a fixed-height reserved busy line on every card (wastes a row).
2. **One icon per activity.** Pull uses lucide `ArrowDownToLine` with a short downward drop animation; delete uses lucide `Trash2` with an opacity pulse. A generic spinner says only "something is happening"; the issue asks for an icon that shows what git is doing.
3. **Facts stay visible and follow the checkout.** Hiding the facts line while busy is itself a layout shift. The guarantee is narrow on purpose: the activity icon never adds, removes, or resizes a line. Facts still follow the checkout's state, so a pull that clears the last change chip still removes the facts line. That is the tree reporting a real change, not the indicator moving things. Reserving space for facts that went away was rejected because it would leave empty rows on idle cards.
4. **Accessibility and tooltips.** The icon sits in a `role="status"` span whose `title` gives the full phrase and which holds visually hidden text with the same phrase, so a screen reader announces it as it appears. The folder row keeps `aria-busy="true"`. The title line's pointer handler already ends the linked-folder details tooltip when the pointer is over a button ("a control on the line says what it does itself"). The activity icon joins that exception, so moving onto it cancels a pending details tooltip or closes a shown one and its native tooltip shows. The delta spec modifies the details tooltip requirement to say so.
5. **Reduced motion.** A `prefers-reduced-motion: reduce` query removes both animations; the static glyphs still differ from the folder and branch icons.
6. **Deletion outranks pulling.** The component derives one activity, `deleting` when `isDeleting` is set, otherwise `pulling` when `isPulling` is set. The icon and the 40% dimming both follow that single value, so a pull that settles mid-deletion leaves the trash icon and dimming in place.

No security or architectural boundary is crossed: this is renderer presentation of state the renderer already holds, with no new IPC, protocol message, or privilege.

## Risks / Trade-offs

- [The folder/branch icon is hidden while git works] → it returns as soon as the activity settles; the name, label and branch line still say which folder it is.
- [A small icon is easier to miss than a line of text] → it animates in the project colour, carries a tooltip, and is announced as a status.
- [Existing e2e tests look for the busy lines' classes and text] → updated in this change to assert the icon, its label, and the unchanged header height.
