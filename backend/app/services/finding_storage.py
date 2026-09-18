import json
import os
from datetime import datetime
from typing import Dict, List, Optional
from backend.app.schemas.finding import Finding, DecisionStatus

class FindingStorageService:
    def __init__(self, persistence_file: str = "/tmp/findings_db.json"):
        self.persistence_file = persistence_file
        self._store: Dict[str, Dict[str, Finding]] = {}  # {project_id: {finding_id: Finding}}
        self._load_from_disk()

    def _load_from_disk(self):
        if os.path.exists(self.persistence_file):
            try:
                with open(self.persistence_file, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
                    for pid, findings_dict in raw_data.items():
                        self._store[pid] = {}
                        for fid, f_data in findings_dict.items():
                            self._store[pid][fid] = Finding(**f_data)
            except Exception as e:
                print(f"Warn: failed to load findings from {self.persistence_file}: {e}")

    def _save_to_disk(self):
        try:
            raw_data = {
                pid: {fid: f.model_dump() for fid, f in f_dict.items()}
                for pid, f_dict in self._store.items()
            }
            with open(self.persistence_file, "w", encoding="utf-8") as f:
                json.dump(raw_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warn: failed to save findings to disk: {e}")

    def save_findings(self, project_id: str, findings: List[Finding]) -> List[Finding]:
        if project_id not in self._store:
            self._store[project_id] = {}
        for finding in findings:
            # 기존에 결정된 내역이 있다면 보존
            if finding.finding_id in self._store[project_id]:
                existing = self._store[project_id][finding.finding_id]
                finding.decision = existing.decision
                finding.decision_reason = existing.decision_reason
                finding.decided_at = existing.decided_at
            self._store[project_id][finding.finding_id] = finding
        self._save_to_disk()
        return list(self._store[project_id].values())

    def get_findings(self, project_id: str) -> List[Finding]:
        return list(self._store.get(project_id, {}).values())

    def get_finding(self, project_id: str, finding_id: str) -> Optional[Finding]:
        return self._store.get(project_id, {}).get(finding_id)

    def update_decision(
        self,
        project_id: str,
        finding_id: str,
        decision: DecisionStatus,
        reason: Optional[str] = None,
    ) -> Optional[Finding]:
        finding = self.get_finding(project_id, finding_id)
        if not finding:
            # 다른 프로젝트에 있는 finding_id인지도 검색 지원
            for pid, f_dict in self._store.items():
                if finding_id in f_dict:
                    finding = f_dict[finding_id]
                    project_id = pid
                    break

        if not finding:
            return None

        finding.decision = decision
        finding.decision_reason = reason
        finding.decided_at = datetime.utcnow().isoformat()
        self._store[project_id][finding_id] = finding
        self._save_to_disk()
        return finding


finding_storage_service = FindingStorageService()
