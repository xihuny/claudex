export interface SessionMeta {
  slug: string;   // full session slug (base project slug, or `${base}::2` etc.)
  name: string;   // user-facing label, e.g. "Session 1"
}

export interface Project {
  name: string;
  path: string;
  session: string;          // the project's base slug = session #1
  launch?: string;
  group?: string;
  sessions?: SessionMeta[];  // present once a project has >1 session; absent ⇒ single implicit primary
}

export interface BrowseResult {
  path: string;
  name: string;
  parent: string | null;
  home: string;
  shortcuts: { name: string; path: string }[];
  entries: { name: string; path: string }[];
}

export interface GitFile { code: string; path: string; }

export interface GitStatus {
  repo: boolean;
  dirty?: boolean;
  ahead?: number;
  behind?: number;      // commits waiting on the remote (as of the last fetch)
  tracking?: boolean;   // branch has an upstream; without one ahead/behind are meaningless
  pending?: boolean;    // something to send out: dirty || ahead
  remote?: boolean;
  // present only with ?files=1 (the git dialog)
  branch?: string;
  files?: GitFile[];
  suggested?: string;   // the auto commit message a push would use
  busy?: boolean;       // Claude is mid-turn in this project
}

export interface GithubRepo {
  full_name: string;
  name: string;
  clone_url: string;
  private: boolean;
  description: string;
}

export interface SetupState {
  platform: string;
  node: string;
  mac: boolean;
  host?: string;
  port?: number;
  hasToken?: boolean;
  claude: string | null;
  deps: boolean;
  pm2Managed: boolean;
  bootEnabled: boolean;
  awake: boolean;
  noSleep: boolean | null;
  cfInstalled: boolean;
  cfRunning: boolean;
  cfUrl: string;
  hooks: boolean;
}
