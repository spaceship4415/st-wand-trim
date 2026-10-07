# Wand Trim

[한국어](README.ko.md)

A SillyTavern extension that tidies up the **wand menu** (the magic wand next to the chat input).
Hide the items you never use and group the rest into folders. Built for phones first.

## Install

Extensions (puzzle icon) → **Install Extension** → paste:

```text
https://github.com/spaceship4415/st-wand-trim
```

## Using it

Open the wand menu. **Tidy menu** (메뉴 정리) is at the very bottom. Tap it to start editing.
While editing, tapping an item does not run it and rows get bigger.

- **Tap the eye** at the right of an item to hide or show it. Hidden items are dimmed and crossed out while editing, and disappear once you finish.
- **Tap the rest of the item** to open its folder panel right below it:
  - **Folder**: move the item out of folders or into one of your folders.
  - **New folder**: type a name and tap **Create and move** to make a folder and put the item in it.
- **Tap a folder** to rename it, move it up or down, or delete it. Deleting a folder moves its items back out; nothing is lost.
- Tap **Finish tidying** (정리 끝내기), or tap outside the menu, to stop editing.

Outside editing, tap a folder to open or close it right inside the menu. Folders start closed after a page reload.
A folder whose items are all hidden is not shown.

Menu order: items outside folders, then folders, then **Tidy menu**. Inside a folder, items keep their original menu order.
Items that other extensions add later can be hidden or put in folders the same way.

## How it works

- It does not move other extensions' menu items in the page. It only changes the order and visibility on screen,
  so extensions that look up their own items keep working.
- Items are remembered by their element id (or their text if they have none). If an extension renames its item's id,
  that item comes back as a new, visible item.

## Where settings are stored

Settings are kept in their own file, not in SillyTavern's `settings.json`:

```text
data/<user>/user/files/st-wand-trim-settings.json
```

When you delete the extension from the extension manager, this file is deleted too.
