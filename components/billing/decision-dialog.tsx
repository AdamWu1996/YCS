'use client';

import { useState } from 'react';
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

interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSummary: {
    totalHours: number;
    recommendedMd: number;
    hasConflict: boolean;
    count: number;
  };
  onConfirm: (finalMd: number, reason: string) => Promise<void>;
}

/**
 * 裁決確認對話框
 * 顯示選中項目的摘要，允許 PM 輸入最終 MD 與原因
 */
export function DecisionDialog({
  open,
  onOpenChange,
  selectedSummary,
  onConfirm,
}: DecisionDialogProps) {
  const [finalMd, setFinalMd] = useState<string>(
    selectedSummary.recommendedMd.toString()
  );
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const mdValue = parseFloat(finalMd);
    if (isNaN(mdValue) || mdValue <= 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(mdValue, reason);
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
