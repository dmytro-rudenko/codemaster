export interface LibraryEntry {
  name: string;
  version: string;
  readme: string | null;
  homepage: string | null;
}

export interface LibraryStale {
  name: string;
  previous: string;
  current: string;
}

export interface LibraryDiff {
  add: LibraryEntry[];
  remove: string[];
  stale: LibraryStale[];
  missing: string[];
  more: number;
}
