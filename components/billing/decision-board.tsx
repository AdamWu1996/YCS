'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClaimableTask, PendingBillingDecision } from '@/actions/billing/queries';
import { createBillingDecision } from '@/actions/billing/decisions';
import { DecisionTable } from './decision-table';
import { DecisionDialog } from './decision-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface BillingDecisionBoardProps {
  initialData: PendingBillingDecision[];
  taskOptions: ClaimableTask[];
}

/**
 * 請款裁決看板主組件
 * 管理選中的時數紀錄，處理裁決流程
 */
export function BillingDecisionBoard({
  initialData,
  taskOptions,
}: BillingDecisionBoardProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'pool' | 'all'>('pool');

  const taskLabelById = useMemo(() => {
    const map = new Map<string, string>();
    taskOptions.forEach((task) => {
      if (!task.project) return;
      map.set(task.id, `${task.project.code}-${task.code}`);
    });
    return map;
  }, [taskOptions]);

  const poolData = useMemo(
    () => data.filter((item) => !item.task_id),
    [data]
  );
  const visibleData = useMemo(() => {
    return viewMode === 'pool' ? poolData : data;
  }, [viewMode, poolData, data]);

  // 移除自動切換邏輯，允許用戶查看公海池的空狀態
  // useEffect(() => {
  //   if (viewMode === 'pool' && poolData.length === 0) {
  //     setViewMode('all');
  //   }
  // }, [viewMode, poolData.length]);

  // 計算選中項目的總時數與建議 MD
  const selectedSummary = useMemo(() => {
    const selected = data.filter((item) => selectedIds.has(item.time_record_id));
    const totalHours = selected.reduce((sum, item) => sum + (item.hours_worked || 0), 0);
    const recommendedMd =
      totalHours >= 7.5 ? 1.0 : totalHours >= 3.5 ? 0.5 : 0;
    const hasConflict = selected.some((item) => item.has_conflict);

    return {
      totalHours,
      recommendedMd,
      hasConflict,
      count: selected.length,
    };
  }, [selectedIds, data]);

  // 處理勾選狀態
  const handleToggleSelect = (timeRecordId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(timeRecordId)) {
      newSelected.delete(timeRecordId);
    } else {
      newSelected.add(timeRecordId);
    }
    setSelectedIds(newSelected);
  };

  // 處理全選/取消全選
  const handleToggleSelectAll = () => {
    if (selectedIds.size === visibleData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleData.map((item) => item.time_record_id)));
    }
  };

  // 重新整理資料
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      router.refresh();
      // 重新取得資料
      const response = await fetch('/api/billing/pending', { cache: 'no-store' });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setData(result.data || []);
        }
      }
    } catch (error) {
      toast.error('重新整理失敗');
    } finally {
      setIsRefreshing(false);
    }
  };

  // 處理裁決確認
  const handleConfirmDecision = async (
    finalMd: number,
    reason: string,
    taskId: string
  ) => {
    if (selectedIds.size === 0) {
      toast.error('請至少選擇一筆時數紀錄');
      return;
    }
    if (!taskId) {
      toast.error('請先選擇專案任務');
      return;
    }

    const timeRecordIds = Array.from(selectedIds);
    const hasConflict = selectedSummary.hasConflict;

    try {
      const result = await createBillingDecision({
        time_record_ids: timeRecordIds,
        task_id: taskId,
        decision_type: hasConflict ? 'conflict_resolved' : 'merged_records',
        final_md: finalMd,
        recommended_md: selectedSummary.recommendedMd,
        reason: reason || 'PM 裁決',
        has_conflict: hasConflict,
        is_conflict_resolved: hasConflict,
        is_billable: true,
      });

      if (result.success) {
        toast.success('裁決成功建立');
        setSelectedIds(new Set());
        setIsDialogOpen(false);
        // 重新整理資料
        router.refresh();
        await handleRefresh();
      } else {
        toast.error(result.error || '裁決失敗');
      }
    } catch (error) {
      toast.error('裁決時發生錯誤');
      console.error(error);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* 操作列 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            已選擇 {selectedIds.size} 筆紀錄
            {selectedIds.size > 0 && (
              <span className="ml-2">
                • 總時數: {selectedSummary.totalHours.toFixed(2)} 小時
                • 建議 MD: {selectedSummary.recommendedMd}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={viewMode === 'pool' ? 'default' : 'outline'}
              onClick={() => {
                setViewMode('pool');
                setSelectedIds(new Set());
              }}
            >
              公海池 ({poolData.length})
            </Button>
            <Button
              variant={viewMode === 'all' ? 'default' : 'outline'}
              onClick={() => {
                setViewMode('all');
                setSelectedIds(new Set());
              }}
            >
              全部待裁決 ({data.length})
            </Button>
            <Button
              variant="outline"
              onClick={handleToggleSelectAll}
              disabled={visibleData.length === 0}
            >
              {selectedIds.size === visibleData.length ? '取消全選' : '全選'}
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? '重新整理中...' : '重新整理'}
            </Button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              disabled={selectedIds.size === 0}
            >
              確認裁決
            </Button>
          </div>
        </div>

        {/* 資料表格 */}
        <DecisionTable
          data={visibleData}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          taskLabelById={taskLabelById}
          viewMode={viewMode}
        />
      </div>

      {/* 裁決確認對話框 */}
      <DecisionDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedSummary={selectedSummary}
        onConfirm={handleConfirmDecision}
        taskOptions={taskOptions}
      />
    </>
  );
}
