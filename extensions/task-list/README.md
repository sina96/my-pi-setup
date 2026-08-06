# simply-task-list

A small, visible task tracker for Pi. It gives the model a `task_list` tool and
renders the current work as a themed widget above the editor, so you can see what
is pending, active, and complete while the agent works.

Inspired by:

- [`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/226ec6e18f94dbed334a76ff907e1759d768b4bb/packages/rpiv-todo)
- [Armin Ronacher's `todos.ts`](https://github.com/mitsuhiko/agent-stuff/blob/d265b8ef32f896d3ef3bc6a45bd7b8e0d02150e0/extensions/todos.ts)
- Pi's built-in stateful todo extension example

This version deliberately stays small: no files, task dependencies, assignment,
localization, or configuration layer. State is stored in tool-result snapshots,
so it follows the current session branch and survives resume, `/reload`, tree
navigation, and compaction.

## Behavior

For work with at least three concrete steps, the tool guidance asks the model to:

1. Create the ordered list before implementation.
2. Keep exactly one item `in_progress`.
3. Mark an item `completed` only after verification.
4. Update the list when scope changes.

The widget shows up to eight rows, keeps the active row visible, and points to
`/tasks` when additional rows are hidden. It disappears when the list is empty.
After every task is completed, the full widget remains visible for one minute
and then hides automatically without clearing the persisted task state. Running
`/tasks` shows the complete list and restores the widget for another minute.

## Commands

```text
/tasks         Show the complete list and restore its widget
/tasks clear   Clear the list after confirmation
```

The model-facing tool supports `set`, `add`, `update`, `list`, and `clear`.

## Try without installing

```bash
pi -e ./extensions/task-list
```

Run `/reload` if this repository is already loaded as your Pi package.

## Install independently

```bash
pi install ./extensions/task-list
```

Remove it with:

```bash
pi remove ./extensions/task-list
```

## Compatibility

Do not load another extension that registers `task_list`. This extension avoids
the generic `todo` tool and `/todos` command names so it can coexist with tools
that use those names, although running two competing task trackers is usually
confusing for the model.
