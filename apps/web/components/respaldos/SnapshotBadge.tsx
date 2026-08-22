import type { ProjectBackupType } from "@kan/plugin-contract";
import { BACKUP_TYPE_LABEL } from "@/lib/respaldos/types";

const BACKUP_TYPE_CLASSES: Record<ProjectBackupType, string> = {
  source: "bg-success/10 text-success",
  binary: "bg-warning/10 text-warning",
  config: "bg-accent/10 text-accent",
};

/** Indicador claro del tipo de backup — nunca el nombre técnico "source"/"binary"/"config" tal cual, mismo criterio que el resto de los badges de severidad en DispositivoClient.tsx. */
export function SnapshotBadge({ backupType }: { backupType: ProjectBackupType }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${BACKUP_TYPE_CLASSES[backupType]}`}>
      {BACKUP_TYPE_LABEL[backupType]}
    </span>
  );
}
