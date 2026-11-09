import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";

/**
 * Lab entries that should be shown (same draft/scheduling rules as
 * posts), newest first by `modDatetime` or `pubDatetime`.
 */
export function getSortedLab(entries: CollectionEntry<"lab">[]) {
  return entries
    .filter(postFilter)
    .sort(
      (a, b) =>
        new Date(b.data.modDatetime ?? b.data.pubDatetime).getTime() -
        new Date(a.data.modDatetime ?? a.data.pubDatetime).getTime()
    );
}

/**
 * URL slug for a lab entry. Folders starting with `_` (like
 * `_examples`) are left out of the URL, matching how posts work.
 */
export function getLabSlug(id: string) {
  return id
    .split("/")
    .filter(segment => !segment.startsWith("_"))
    .join("/");
}
