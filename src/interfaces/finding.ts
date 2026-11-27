export interface FindingItem {
  severity: "error" | "warning";
  ruleId: string;
  file: string;
  line: number;
  message: string;
  reason?: string;
}

export interface FindingSummary {
  errors: number;
  warnings: number;
  files: number;
}
