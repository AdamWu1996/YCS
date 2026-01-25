'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import type { ClaimableTask } from '@/actions/billing/queries';

interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSummary: {
    totalHours: number;
    recommendedMd: number;
    hasConflict: boolean;
    count: number;
  };
  taskOptions: ClaimableTask[];
  onConfirm: (finalMd: number, reason: string, taskId: string) => Promise<void>;
}

/**
 * 裁決確認對話框
 * 顯示選中項目的摘要，允許 PM 輸入最終 MD 與原因
 */
export function DecisionDialog({
  open,
  onOpenChange,
  selectedSummary,
  taskOptions,
  onConfirm,
}: DecisionDialogProps) {
  const [finalMd, setFinalMd] = useState<string>(
    selectedSummary.recommendedMd.toString()
  );
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');

  const projectOptions = useMemo(() => {
    const projectMap = new Map<string, { id: string; code: string; name: string }>();
    taskOptions.forEach((task) => {
      if (task.project) {
        projectMap.set(task.project.id, task.project);
      }
    });
    return Array.from(projectMap.values()).sort((a, b) =>
      a.code.localeCompare(b.code)
    );
  }, [taskOptions]);

  const tasksForProject = useMemo(() => {
    if (!selectedProjectId) return [];
    return taskOptions
      .filter((task) => task.project?.id === selectedProjectId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [taskOptions, selectedProjectId]);

  const selectedTask = useMemo(() => {
    return taskOptions.find((task) => task.id === selectedTaskId) ?? null;
  }, [taskOptions, selectedTaskId]);

  const projectStats = useMemo(() => {
    if (!selectedProjectId) {
      return {
        usedMd: 0,
        budgetedMd: 0,
        hasBudget: false,
      };
    }

    const usedMd = tasksForProject.reduce((sum, task) => sum + (task.used_md || 0), 0);
    const budgetedMd = tasksForProject.reduce(
      (sum, task) => sum + (task.budgeted_md || 0),
      0
    );
    const hasBudget = tasksForProject.some((task) => task.budgeted_md !== null);

    return {
      usedMd,
      budgetedMd,
      hasBudget,
    };
  }, [selectedProjectId, tasksForProject]);

  useEffect(() => {
    if (!open) return;
    if (projectOptions.length === 0) return;
    if (!selectedProjectId) {
      setSelectedProjectId(projectOptions[0].id);
    }
  }, [open, projectOptions, selectedProjectId]);

  useEffect(() => {
    if (!open) return;
    if (tasksForProject.length === 0) {
      setSelectedTaskId('');
      return;
    }
    if (!selectedTaskId || !tasksForProject.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasksForProject[0].id);
    }
  }, [open, tasksForProject, selectedTaskId]);

  useEffect(() => {
    if (!open) return;
    setFinalMd(selectedSummary.recommendedMd.toString());
    setReason('');
  }, [open, selectedSummary.recommendedMd]);

  const handleSubmit = async () => {
    const mdValue = parseFloat(finalMd);
    if (isNaN(mdValue) || mdValue <= 0) {
      return;
    }
    if (!selectedTaskId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(mdValue, reason, selectedTaskId);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>確認裁決</DialogTitle>
          <DialogDescription>
            請確認裁決資訊並輸入裁決原因
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 專案與任務選擇 */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="project-select">專案 *</Label>
              <Select
                id="project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={projectOptions.length === 0}
              >
                {projectOptions.length === 0 && (
                  <option value="">沒有可用專案</option>
                )}
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} {project.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-select">任務 *</Label>
              <Select
                id="task-select"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                disabled={tasksForProject.length === 0}
              >
                {tasksForProject.length === 0 && (
                  <option value="">沒有可用任務</option>
                )}
                {tasksForProject.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.code} {task.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* 摘要資訊 */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">選中筆數：</span>
              <span className="font-medium">{selectedSummary.count} 筆</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">總時數：</span>
              <span className="font-medium">
                {selectedSummary.totalHours.toFixed(2)} 小時
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">建議 MD：</span>
              <span className="font-medium">{selectedSummary.recommendedMd}</span>
            </div>
            {selectedSummary.hasConflict && (
              <div className="flex justify-between text-yellow-600">
                <span className="text-sm">⚠️ 注意：</span>
                <span className="text-sm font-medium">包含衝突紀錄</span>
              </div>
            )}
          </div>

          {/* 任務進度 */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">任務已用 MD：</span>
              <span className="font-medium">
                {selectedTask?.used_md !== null && selectedTask?.used_md !== undefined
                  ? selectedTask.used_md.toFixed(2)
                  : '0.00'} /
                {selectedTask?.budgeted_md !== null && selectedTask?.budgeted_md !== undefined
                  ? ` ${selectedTask.budgeted_md.toFixed(2)}`
                  : ' 未設定'} MD
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">本次裁決 MD：</span>
              <span className="font-medium">
                {!isNaN(parseFloat(finalMd)) ? parseFloat(finalMd).toFixed(2) : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">裁決後累計 MD：</span>
              <span className="font-medium">
                {selectedTask?.used_md !== null && selectedTask?.used_md !== undefined && !isNaN(parseFloat(finalMd))
                  ? (selectedTask.used_md + parseFloat(finalMd)).toFixed(2)
                  : '-'} /
                {selectedTask?.budgeted_md !== null && selectedTask?.budgeted_md !== undefined
                  ? ` ${selectedTask.budgeted_md.toFixed(2)}`
                  : ' 未設定'} MD
              </span>
            </div>
          </div>

          {/* 最終 MD 輸入 */}
          <div className="space-y-2">
            <Label htmlFor="final-md">最終 MD *</Label>
            <Input
              id="final-md"
              type="number"
              step="0.1"
              min="0.5"
              max="10"
              value={finalMd}
              onChange={(e) => setFinalMd(e.target.value)}
              placeholder="輸入最終 MD 值"
            />
            <p className="text-xs text-muted-foreground">
              建議值：{selectedSummary.recommendedMd}（{selectedSummary.totalHours >= 4 ? '>=4 小時' : '<4 小時'}）
            </p>
          </div>

          {/* 裁決原因 */}
          <div className="space-y-2">
            <Label htmlFor="reason">裁決原因 *</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="請輸入裁決原因..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              !selectedTaskId ||
              !reason.trim() ||
              isNaN(parseFloat(finalMd)) ||
              parseFloat(finalMd) <= 0
            }
          >
            {isSubmitting ? '處理中...' : '確認裁決'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
