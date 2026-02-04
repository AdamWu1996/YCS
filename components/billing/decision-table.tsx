'use client';

import type { PendingBillingDecision } from '@/actions/billing/queries';
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
const pad2 = (n: number) => String(n).padStart(2, '0');
function formatDate(date: string | Date, formatStr: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  if (formatStr === 'yyyy/MM/dd') {
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  }
  if (formatStr === 'HH:mm') {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  if (formatStr === 'yyyy/MM/dd HH:mm') {
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return d.toLocaleDateString('zh-TW');
}

interface DecisionTableProps {
  data: PendingBillingDecision[];
  selectedIds: Set<string>;
  onToggleSelect: (timeRecordId: string) => void;
  onToggleSelectAll?: () => void;
  taskLabelById?: Map<string, string>;
  viewMode?: 'pool' | 'all';
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
  taskLabelById,
  viewMode = 'all',
}: DecisionTableProps) {
  if (data.length === 0) {
    const emptyMessage =
      viewMode === 'pool'
        ? '公海池目前沒有未認領的工時紀錄（所有工時都已認領至專案任務）'
        : '目前沒有待裁決的時數紀錄';
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        {emptyMessage}
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
            <TableHead>所屬廠區</TableHead>
            <TableHead>廠商編號</TableHead>
            <TableHead>實際入廠日期時間</TableHead>
            <TableHead>實際出廠日期時間</TableHead>
            <TableHead>部門名稱</TableHead>
            <TableHead>廠商姓名</TableHead>
            <TableHead>工作區域代號</TableHead>
            <TableHead>日期</TableHead>
            <TableHead>任務</TableHead>
            <TableHead>時數</TableHead>
            <TableHead>MD</TableHead>
            <TableHead>備註</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => {
            const status = getStatusLight(item);
            const isSelected = selectedIds.has(item.time_record_id);
            const taskLabel = item.task_id
              ? taskLabelById?.get(item.task_id) ?? '未知任務'
              : '未認領';

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
                <TableCell>{item.factory_location}</TableCell>
                <TableCell>{item.staff_employee_no ?? '-'}</TableCell>
                <TableCell>
                  {item.check_in_time
                    ? formatDate(item.check_in_time, 'yyyy/MM/dd HH:mm')
                    : '-'}
                </TableCell>
                <TableCell>
                  {item.check_out_time
                    ? formatDate(item.check_out_time, 'yyyy/MM/dd HH:mm')
                    : '-'}
                </TableCell>
                <TableCell>{item.department_name ?? '-'}</TableCell>
                <TableCell>{item.staff_name ?? '-'}</TableCell>
                <TableCell>{item.work_area_code ?? '-'}</TableCell>
                <TableCell>
                  {formatDate(item.record_date, 'yyyy/MM/dd')}
                </TableCell>
                <TableCell className="text-sm">{taskLabel}</TableCell>
                <TableCell>{item.hours_worked?.toFixed(2) || '0.00'}</TableCell>
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
