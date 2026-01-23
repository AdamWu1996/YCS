'use client';

import { PendingBillingDecision } from '@/actions/billing/queries';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
// 日期格式化輔助函數
function formatDate(date: string | Date, formatStr: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  
  if (formatStr === 'yyyy/MM/dd') {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }
  
  if (formatStr === 'HH:mm') {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  return d.toLocaleDateString('zh-TW');
}

interface DecisionTableProps {
  data: PendingBillingDecision[];
  selectedIds: Set<string>;
  onToggleSelect: (timeRecordId: string) => void;
  onToggleSelectAll?: () => void;
}

/**
 * 判斷燈號顏色
 * 🔴 紅燈：has_conflict === true
 * 🟡 黃燈：has_conflict === false && hours_worked < 4
 * 🟢 綠燈：has_conflict === false && hours_worked >= 4
 */
function getStatusLight(item: PendingBillingDecision): {
  color: 'red' | 'yellow' | 'green';
  label: string;
} {
  if (item.has_conflict) {
    return { color: 'red', label: '衝突' };
  }
  if ((item.hours_worked || 0) < 4) {
    return { color: 'yellow', label: '時數不足' };
  }
  return { color: 'green', label: '正常' };
}

/**
 * 時數紀錄表格組件
 * 顯示待裁決的時數紀錄，支援多選
 */
export function DecisionTable({
  data,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: DecisionTableProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        目前沒有待裁決的時數紀錄
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={selectedIds.size === data.length && data.length > 0}
                onChange={() => onToggleSelectAll?.()}
              />
            </TableHead>
            <TableHead>狀態</TableHead>
            <TableHead>日期</TableHead>
            <TableHead>廠區</TableHead>
            <TableHead>時數</TableHead>
            <TableHead>進場時間</TableHead>
            <TableHead>出場時間</TableHead>
            <TableHead>MD</TableHead>
            <TableHead>備註</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => {
            const status = getStatusLight(item);
            const isSelected = selectedIds.has(item.time_record_id);

            return (
              <TableRow key={item.time_record_id}>
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(item.time_record_id)}
                  />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      status.color === 'red'
                        ? 'destructive'
                        : status.color === 'yellow'
                        ? 'default'
                        : 'default'
                    }
                    className={
                      status.color === 'green'
                        ? 'bg-green-500 hover:bg-green-600'
                        : status.color === 'yellow'
                        ? 'bg-yellow-500 hover:bg-yellow-600'
                        : ''
                    }
                  >
                    {status.color === 'red' && '🔴'}
                    {status.color === 'yellow' && '🟡'}
                    {status.color === 'green' && '🟢'} {status.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatDate(item.record_date, 'yyyy/MM/dd')}
                </TableCell>
                <TableCell>{item.factory_location}</TableCell>
                <TableCell>{item.hours_worked?.toFixed(2) || '0.00'}</TableCell>
                <TableCell>
                  {item.check_in_time ? formatDate(item.check_in_time, 'HH:mm') : '-'}
                </TableCell>
                <TableCell>
                  {item.check_out_time ? formatDate(item.check_out_time, 'HH:mm') : '-'}
                </TableCell>
                <TableCell>
                  {item.final_md !== null ? item.final_md.toFixed(1) : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.has_conflict && '⚠️ 衝突'}
                  {item.has_decision && '✓ 已裁決'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
